class InstancingTechnique {
    constructor(ctx, shaderRegistry, layout, bindGroups) {
        this.ctx = ctx;
        this.device = ctx.device;
        let width = ctx.canvas.width;
        let height = ctx.canvas.height;

        let device = this.device;

        // Main point primitives rendering pass
        let module = device.createShaderModule({ code: shaderRegistry["mesh.wgsl"] });
        this.mainPipeline = device.createRenderPipeline({
            vertex: {
                module,
                entryPoint: "vsQuad3",
                buffers : [{
                    arrayStride: 28,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                        { format: "float32", offset: 24, shaderLocation: 2 }
                    ],
                    stepMode: "instance" // <- Note this
                }],
            },
            fragment: {
                module,
                entryPoint: "fragmentMain",
                targets: [{ format:  navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil : {
               depthWriteEnabled: true,
               depthCompare: "less",
               format: "depth32float" 
            },
            layout,
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

        this.pointBuffer = this.device.createBuffer({
            size: pointCloud.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.pointBuffer, 0, pointCloud);
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
        pass.setVertexBuffer(0, this.pointBuffer);
        pass.setIndexBuffer(this.singleQuadIBuffer, "uint32");

        pass.drawIndexed(6, this.numPoints);

        pass.end();
    }
}

export { InstancingTechnique };
