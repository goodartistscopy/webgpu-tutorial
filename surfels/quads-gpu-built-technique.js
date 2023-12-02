// Similar to QuadsCPUBuiltTechnique, but here the quads are displaced dynamically
// in the vertex shader, the point size factor can be a uniform value, the buffer
// does not need rebuilding when its value change
class QuadsGPUBuiltTechnique {
    constructor(ctx, shaderRegistry, layouts, bindGroups) {
        this.ctx = ctx;
        this.device = ctx.device;
        let width = ctx.canvas.width;
        let height = ctx.canvas.height;

        let device = this.device;

        // Main quad rendering pass
        let module = device.createShaderModule({ code: shaderRegistry["mesh.wgsl"] });
        this.mainPipeline = device.createRenderPipeline({
            vertex: {
                module,
                entryPoint: "vsQuadProcedural",
                buffers : [{
                    arrayStride: 28,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                        { format: "float32", offset: 24, shaderLocation: 2 }
                    ]
                }],
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
            layout: device.createPipelineLayout({bindGroupLayouts: layouts}),
        });

        this.zbuffer = device.createTexture({ format: "depth32float", size: [ctx.canvas.width, ctx.canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView();
    
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

        this.#rebuildBuffers();
    }
     
    // Build a vertex buffers containing 4 times as much point, one for each corners of each quads.
    // Each corner store the locaiton and normal of the original point, and the point size/radius.
    // Local coordinates are reconstructed in the vertex shader.
    // Build a corresponding index buffer (2 triangles per quads).
    #rebuildBuffers() {
        let corners = new Float32Array(4 * this.numPoints * 9);
        let triPairs = new Uint32Array(this.numPoints * 6);
        let cornerPos = new Float32Array(3);
        for (let i = 0; i < this.numPoints; i++) {
            let point = this.basePointCloud.subarray(7 * i, 7 * i + 3);
            let normal = this.basePointCloud.subarray(7 * i + 3, 7 * i + 6);
            const offsets = [ [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5] ];
            for (let j = 0; j < 4; j++) {
                let size = this.basePointCloud[7 * i + 6];
                corners[7 * (4 * i + j) + 0] = point[0];
                corners[7 * (4 * i + j) + 1] = point[1];
                corners[7 * (4 * i + j) + 2] = point[2];
                corners[7 * (4 * i + j) + 3] = normal[0];
                corners[7 * (4 * i + j) + 4] = normal[1];
                corners[7 * (4 * i + j) + 5] = normal[2];
                corners[7 * (4 * i + j) + 6] = size;
            }
            
            const indices = [0, 1, 2, 1, 3, 2];
            for (let j = 0; j < 6; j++) {
                triPairs[6 * i + j] = 4 * i + indices[j];
            }
        }
    
        // This could be optimized, not recreating the buffers if their sizes don't change (also the index buffer
        // is always the same)
        this.quadVBuffer = this.device.createBuffer({size: corners.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, });
        this.device.queue.writeBuffer(this.quadVBuffer, 0, corners);

        this.quadIBuffer = this.device.createBuffer({size: triPairs.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, });
        this.device.queue.writeBuffer(this.quadIBuffer, 0, triPairs);
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
        pass.setVertexBuffer(0, this.quadVBuffer);
        pass.setIndexBuffer(this.quadIBuffer, "uint32");

        pass.drawIndexed(6 * this.numPoints);
        pass.end();
    }
}


export { QuadsGPUBuiltTechnique };
