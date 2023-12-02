class PointPrimitiveTechnique {
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
                entryPoint: "vertexMain",
                buffers : [{
                    arrayStride: 28,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                        // unused radius
                    ]
                }],
            },
            fragment: {
                module,
                entryPoint: "fragmentMain",
                targets: [{ format: "rgba8unorm" }],
            },
            primitive: { topology: "point-list" },
            layout,
        });

        // Render target texture (also bound for reading in the post-process pass)
        this.renderTarget = device.createTexture({
            format: "rgba8unorm",
            size: [ width, height ],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        }).createView();

        // Post processing pass to enlarge the points (in screen space)
        module = device.createShaderModule({ code: shaderRegistry["dilate.wgsl"] });
        this.postProcessPipeline = device.createRenderPipeline({
            vertex: { module, entryPoint: "vs" },
            fragment: { module, entryPoint: "fs", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
            primitive: { topology: "triangle-list" },
            layout: "auto",
        });

        // Uniform buffer for:
        // struct FilterParam {
        //     size: u32,  // +12 bytes padding
        //     bg_color: vec4f,
        // }
        this.uniforms = device.createBuffer({size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.FRAGMENT | GPUBufferUsage.COPY_DST});
        
        this.postProcessBindGroup = device.createBindGroup({
            entries: [
                { binding: 0, resource: this.renderTarget },
                { binding: 1, resource: { buffer: this.uniforms } }
            ],
            layout: this.postProcessPipeline.getBindGroupLayout(0)
        });

        this.bindGroups = bindGroups;
        this.backgroundColor = [1.0, 1.0, 1.0, 1.0];
        this.pointSize = 1.0;
    }

    // Note: we should probably batch these updates in a single write
    set backgroundColor(color) {
        this.bgColor = color;
        this.device.queue.writeBuffer(this.uniforms, 16, new Float32Array(color));
    }

    set pointSizeFactor(factor) {
        this.device.queue.writeBuffer(this.uniforms, 0, new Uint32Array([factor]));
    }

    // Points clouds should hold 7 floats per points (position, normal, radius)
    set pointCloud(pointCloud) {
        this.numPoints = pointCloud.length / 7;

        this.pointBuffer = this.device.createBuffer({
            size: pointCloud.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.pointBuffer, 0, pointCloud);
    }
     
    run(encoder) {
        // main pass
        let pass = encoder.beginRenderPass({ label: "Main",
            colorAttachments: [
                {
                    clearValue: this.bgColor,
                    loadOp: "clear",
                    storeOp: "store",
                    view: this.renderTarget,
                },
            ]
        });

        pass.setPipeline(this.mainPipeline);
        pass.setBindGroup(0, this.bindGroups[0]);
        pass.setBindGroup(1, this.bindGroups[1]);
        pass.setVertexBuffer(0, this.pointBuffer);

        pass.draw(this.numPoints);
        pass.end();

        // post-process pass
        pass = encoder.beginRenderPass({ label: "Dilate",
            colorAttachments: [
                {
                    loadOp: "clear", // Note: clear to (implicit) 0 is probably a "fast-clear" (here we "don't care").
                    storeOp: "store",
                    view: this.ctx.context.getCurrentTexture().createView(),
                },
            ]
        });

        pass.setPipeline(this.postProcessPipeline);
        pass.setBindGroup(0, this.postProcessBindGroup);
        pass.draw(3);
        pass.end(); 
    }
}

export { PointPrimitiveTechnique };
