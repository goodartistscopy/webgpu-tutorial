// Canonical replacement for drawing variable sized points when native API support
// is lacking (like GL_POINTS and gl_PointSize in the VS)
// Draw a single quad (here generated procedurally), instanced at the location of
// the points.
// The class also implement a more advance splat blending approach similar to the
// QSPlat technique, where the rasterized fragments are weighted according to their
// distance to the splat center. Multiple splats contributions are blended (summed)
// together thanks to a fuzzy-depth test implemented by shifting the splats sligthly
// away from in the view direction in a depth only pre-pass.
// A final full screen pass normalizes the weights.
class InstancingTechnique {
    constructor(ctx, shaderRegistry, layouts, bindGroups) {
        this.ctx = ctx;
        this.device = ctx.device;
        let width = ctx.canvas.width;
        let height = ctx.canvas.height;

        let device = this.device;

        let module = device.createShaderModule({ code: shaderRegistry["surfels.wgsl"] });
        // Main quads rendering pass
        let descriptor = {
            vertex: {
                module,
                entryPoint: "vsQuadInstancing",
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
        };
        this.mainPipeline = device.createRenderPipeline(descriptor);

        // Fuzzy-depth prepass
        let depthUniformLayout = device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" }}]
         });
        let depthDescriptor = { label: "depthPipeline",
            vertex: {
                module,
                entryPoint: "vsQuadInstancingDepth",
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
                entryPoint: "fsQuadInstancingDepth",
                targets: [], // No color render target, we just compute a depth
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil : {
               depthWriteEnabled: true,
               depthCompare: "less",
               format: "depth32float" 
            },
            layout: device.createPipelineLayout({bindGroupLayouts: layouts.concat([depthUniformLayout])})
        };
        
        this.depthPipeline = device.createRenderPipeline(depthDescriptor);

        this.depthUniform = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.depthBindGroup = device.createBindGroup({
            entries: [{ binding: 0, resource: { buffer: this.depthUniform } }],
            layout: this.depthPipeline.getBindGroupLayout(2)
        });

        // Splat accumulation pass.
        // Change entry point, adjust attachment format and blending 
        descriptor.fragment.entryPoint = "splatAccumulate";
        // We need an unormalised format (and more precision) to sum the contributions
        // However, rgba32float is non blendable.
        descriptor.fragment.targets[0].format = "rgba16float";  
        descriptor.fragment.targets[0].blend = { color: { srcFactor: "src-alpha", dstFactor: "one" },
                                                 alpha: { srcFactor: "one", dstFactor: "one" } };
        descriptor.depthStencil.depthWriteEnabled = false;
        descriptor.depthStencil.depthCompare = "less-equal";

        this.splatPipeline = device.createRenderPipeline(descriptor);

        // last (post-processing) pass to normalize the sum of splat contributions
        this.normalizePipeline = device.createRenderPipeline({
            vertex: { module, entryPoint: "vsFullScreenTriangle" },
            fragment: { module, entryPoint: "normalizeSplatWeights",
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    // blending is just here so that the pass can pass along background pixels 
                    blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                             alpha: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" } },
                }]
            },
            primitive: { topology: "triangle-list" },
            layout: "auto",
        });

        this.splatAccumTexture = device.createTexture({
            format: "rgba16float",
            size: [ width, height ],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        }).createView();
        this.splatAccumTextureGroup = device.createBindGroup({
            entries: [
                { binding: 0, resource: this.splatAccumTexture },
            ],
            layout: this.normalizePipeline.getBindGroupLayout(0)
        });

        this.zbuffer = device.createTexture({ format: "depth32float", size: [ctx.canvas.width, ctx.canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView();
    
        // Index buffers for a single quad
        let singleQuad = new Uint32Array([0, 1, 2, 1, 3, 2]);
        this.singleQuadIBuffer = device.createBuffer({ size: singleQuad.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.singleQuadIBuffer, 0, singleQuad);
            
        this.backgroundColor = [1.0, 1.0, 1.0, 1.0];
        this.blendSplats = false;
        this.depthFuzziness = 1e-2;

        this.bindGroups = bindGroups;
    }

    set depthFuzziness(eps) {
        this.device.queue.writeBuffer(this.depthUniform, 0, new Float32Array([eps]));
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
        if (this.blendSplats) {
            // depth prepass
            let pass = encoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    view: this.zbuffer
                }
            });

            pass.setPipeline(this.depthPipeline);
            pass.setBindGroup(0, this.bindGroups[0]);
            pass.setBindGroup(1, this.bindGroups[1]);
            pass.setBindGroup(2, this.depthBindGroup);
            pass.setVertexBuffer(0, this.pointBuffer);
            pass.setIndexBuffer(this.singleQuadIBuffer, "uint32");

            pass.drawIndexed(6, this.numPoints);
            pass.end();

            // splatting pass 
            pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        //clearValue: this.bgColor,
                        loadOp: "clear",
                        storeOp: "store",
                        view: this.splatAccumTexture,
                        // view: this.ctx.context.getCurrentTexture().createView(),
                    },
                ],
                depthStencilAttachment: {
                    depthLoadOp: "load", // Use the previously computed depth
                    depthStoreOp: "store",
                    view: this.zbuffer
                }
            });

            pass.setPipeline(this.splatPipeline);
            pass.setBindGroup(0, this.bindGroups[0]);
            pass.setBindGroup(1, this.bindGroups[1]);
            pass.setVertexBuffer(0, this.pointBuffer);
            pass.setIndexBuffer(this.singleQuadIBuffer, "uint32");

            pass.drawIndexed(6, this.numPoints);
            pass.end();

            // post-process pass
            pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        clearValue: this.bgColor,
                        loadOp: "clear",
                        storeOp: "store",
                        view: this.ctx.context.getCurrentTexture().createView(),
                    },
                ],
            });

            pass.setPipeline(this.normalizePipeline);
            pass.setBindGroup(0, this.splatAccumTextureGroup);
            pass.draw(3);
            pass.end();

        } else {
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
}

export { InstancingTechnique };
