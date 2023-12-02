import { vec3, mat3 } from "../ext/gl-matrix/dist/esm/index.js"

// Render a quad per points. The vertex buffer is constructed on the CPU
// including displacing each quad corner the right amount in the point "plane"
// depending on the point radius/size.
// The buffer has to be reconstructed whenever the size factor is changed.
class QuadsCPUBuiltTechnique {
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
                entryPoint: "vsQuad",
                buffers : [{
                    arrayStride: 32,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                        { format: "float32x2", offset: 24, shaderLocation: 2 }
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
        this.pointSizeFactor = 1.0;

        this.bindGroups = bindGroups;
    }

    set backgroundColor(color) {
        this.bgColor = color;
    }

    set pointSizeFactor(factor) {
        this.factor = factor;
        this.#rebuildBuffers();
    }

    // Points clouds should hold 7 floats per points (position, normal, radius)
    set pointCloud(pointCloud) {
        this.numPoints = pointCloud.length / 7;
        this.basePointCloud = pointCloud;

        this.#rebuildBuffers();
    }
     
    // Build a vertex buffers containing 4 times as much point, one for each corners of each quads
    // Each point also store the local coordinates inside the quad. Point radius is not needed.
    // Build a corresponding index buffer (2 triangles per quads)
    #rebuildBuffers() {
        let normalMat = new Float32Array(9);
        let t = normalMat.subarray(0, 3);
        let b = normalMat.subarray(3, 6);
        let n = normalMat.subarray(6, 9);
        let makeNormalMat = (normal) => {
            vec3.copy(n, normal);
            if (Math.abs(n[2]) < Math.abs(n[1])) {
                vec3.cross(t, n, [0.0, 0.0, 1.0]);
            } else {
                vec3.cross(t, n, [0.0, 1.0, 0.0]);
            }
            vec3.cross(b, n, t);
        };

        let corners = new Float32Array(4 * this.numPoints * 8);
        let triPairs = new Uint32Array(this.numPoints * 6);
        let cornerPos = new Float32Array(3);
        for (let i = 0; i < this.numPoints; i++) {
            let point = this.basePointCloud.subarray(7 * i, 7 * i + 3);
            let normal = this.basePointCloud.subarray(7 * i + 3, 7 * i + 6);
            makeNormalMat(normal);
            const offsets = [ [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5] ];
            for (let j = 0; j < 4; j++) {
                let size = this.factor * this.basePointCloud[7 * i + 6];
                let cTSpace = [size * offsets[j][0], size * offsets[j][1], 0.0];
                mat3.mul(cornerPos, normalMat, cTSpace);
                corners[8 * (4 * i + j) + 0] = point[0] + cornerPos[0];
                corners[8 * (4 * i + j) + 1] = point[1] + cornerPos[1];
                corners[8 * (4 * i + j) + 2] = point[2] + cornerPos[2];
                corners[8 * (4 * i + j) + 3] = normal[0];
                corners[8 * (4 * i + j) + 4] = normal[1];
                corners[8 * (4 * i + j) + 5] = normal[2];
                corners[8 * (4 * i + j) + 6] = 2.0 * offsets[j][0];
                corners[8 * (4 * i + j) + 7] = 2.0 * offsets[j][1];
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


export { QuadsCPUBuiltTechnique };
