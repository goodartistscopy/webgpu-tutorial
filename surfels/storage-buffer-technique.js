// Here we just implement "by hand" the access to the vertex data withut resorting
// to vertex buffers, using 'instance_index' to retrieve the point properties and
// 'vertex_index' to procedurally construct the quad.
// Note that vertex buffers have very relaxed alignment constraints (4 bytes) for
// attributes, whereas storage buffer variables have more complex rules, making
// these kind of approach to vertex data management sometimes less ideal. Here we
// mitigate the issue by reordering the fields of the vertex structure, which leads
// to only 4 additional bytes of padding (per vertex though!).
class StorageBufferTechnique {
    constructor(ctx, shaderRegistry, layouts, bindGroups) {
        this.ctx = ctx;
        this.device = ctx.device;
        let width = ctx.canvas.width;
        let height = ctx.canvas.height;

        let device = this.device;

        // Main quad rendering pass
        let module = device.createShaderModule({ code: shaderRegistry["mesh.wgsl"] });
        
        let layoutStorageBuffer = device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" }}]
        });
        let extendedLayouts = layouts.concat([layoutStorageBuffer]);
        
        this.mainPipeline = device.createRenderPipeline({
            vertex: {
                module,
                entryPoint: "vsQuadManual",
                buffers : [],
            },
            fragment: {
                module,
                entryPoint: "drawPoint",
                targets: [{ format:  navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil : {
               depthWriteEnabled: true,
               depthCompare: "less",
               format: "depth32float" 
            },
            layout: device.createPipelineLayout({bindGroupLayouts: extendedLayouts}),
        });

        this.zbuffer = device.createTexture({ format: "depth32float", size: [ctx.canvas.width, ctx.canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView();
    
        // Index buffers for a single quad
        let singleQuad = new Uint32Array([0, 1, 2, 1, 3, 2]);
        this.singleQuadIBuffer = device.createBuffer({ size: singleQuad.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.singleQuadIBuffer, 0, singleQuad);
            
        this.backgroundColor = [1.0, 1.0, 1.0, 1.0];

        this.bindGroups = bindGroups;
    }

    set backgroundColor(color) {
        this.bgColor = color;
    }

    // Points clouds should hold 7 floats per points (position, normal, radius)
    set pointCloud(pointCloud) {
        this.numPoints = pointCloud.length / 7;
        this.basePointCloud = pointCloud;

        this.#rebuildBuffer();
    }
     
    // The storage buffer is logically identical to the base point cloud, but storage buffers have
    // stricter alignment constraints for their fields than vertex buffers attributes, so we need
    // to shuffle the data around to account for padding.
    // The strucure is defined like so in the shader:
    // struct PointData {
    //     position: vec3f,
    //     size: f32,
    //     normal: vec3f,
    // }
    #rebuildBuffer() {
        let points = new Float32Array(this.numPoints * 8); // 1 byte of padding
        for (let i = 0; i < this.numPoints; i++) {
            points[8 * i + 0] = this.basePointCloud[7 * i + 0]; 
            points[8 * i + 1] = this.basePointCloud[7 * i + 1];
            points[8 * i + 2] = this.basePointCloud[7 * i + 2];
            points[8 * i + 3] = this.basePointCloud[7 * i + 6]; 
            points[8 * i + 4] = this.basePointCloud[7 * i + 3];
            points[8 * i + 5] = this.basePointCloud[7 * i + 4];
            points[8 * i + 6] = this.basePointCloud[7 * i + 5];
        }

        // again, we could try to avoid recreating the buffer every time
        this.pointStorageBuffer = this.device.createBuffer({
            size: points.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.pointStorageBuffer, 0, points);

        // In a real scenario, this would preferably be defined as a second entry of group 1
        this.pointCloudBindGroup = this.device.createBindGroup({
            entries: [
                { binding: 0, resource: { buffer: this.pointStorageBuffer }, }, 
            ],
            layout: this.mainPipeline.getBindGroupLayout(2)
        });
    }

    run(encoder) {
        let pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    clearValue: this.bgColor,
                    loadOp: "clear",
                    storeOp: "store",
                    view: this.ctx.context.getCurrentTexture().createView(),
                },
            ],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: this.zbuffer
            }
        });

        pass.setPipeline(this.mainPipeline);
        pass.setBindGroup(0, this.bindGroups[0]);
        pass.setBindGroup(1, this.bindGroups[1]);
        pass.setBindGroup(2, this.pointCloudBindGroup);
        pass.setIndexBuffer(this.singleQuadIBuffer, "uint32");

        pass.drawIndexed(6, this.numPoints);

        pass.end();
    }
}

export { StorageBufferTechnique };
