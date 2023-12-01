import { vec3, mat3, mat4 } from "../ext/gl-matrix/dist/esm/index.js";

const shaderFiles = ["mesh.wgsl", "dilate.wgsl"];
const CAM_ROT_PHI_PER_PIXELS = radians(0.25);
const CAM_ROT_THETA_PER_PIXELS = radians(0.25);

async function setupCanvas(canvasId) {
    if (!navigator.gpu) {
        throw Error("WebGPU not supported.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw Error("Couldn't request WebGPU adapter.");
    }

    // Create a GPUDevice
    let device = await adapter.requestDevice();

    // Use lost to handle lost devices
    device.lost.then((info) => {
        console.error(`WebGPU device was lost: ${info.message}`);
        device = null;

        if (info.reason !== "destroyed") {
            setupConvas();
        }
    });

    // Get a context to display our rendered image on the canvas
    let canvas = document.getElementById(canvasId);
    let context = canvas.getContext("webgpu");

    let format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: format,
        alphaMode: "opaque",
        colorSpace: "srgb",
    });

    return { device, context, canvas };
}

let shaderSources = shaderFiles.map((file) => {
    return fetch(file, { cache: "no-cache" })
        .then((response) => {
            if (response.status >= 200 && response.status < 400) {
                return response.text();
            } else {
                throw undefined;
            }
        })
        .then((text) => ({ file, text }))
        .catch(() => ({ file, text: `// File ${file} not found` }));
});

let meshFileContent = fetch("../data/bunny.txt").then(response => response.arrayBuffer()).then(buffer => new Uint8Array(buffer));

function radians(degrees) {
    return degrees * (Math.PI / 180.0);
}

function clamp(v, a, b) {
    return Math.min(Math.max(v, a), b);
}

function updateViewMats(mat, invMat, pov) {
    let eye = [Math.sin(pov.phi) * Math.cos(pov.theta), Math.cos(pov.phi), Math.sin(pov.phi) * Math.sin(pov.theta)];
    vec3.scale(eye, eye, pov.dist);
    let up = [0.0, 1.0, 0.0];
    mat4.lookAt(mat, eye, [0.0, 0.0, 0.0], up);
    mat4.invert(invMat, mat);
}

function createPointCloud(numPoints) {
    let vbuffer = new Float32Array(numPoints * 7);
    for (let i = 0; i < numPoints; i++) {
        // position in [-1.0, 1.0[
        vbuffer[7 * i + 0] = 2.0 * Math.random() - 1.0;
        vbuffer[7 * i + 1] = 2.0 * Math.random() - 1.0;
        vbuffer[7 * i + 2] = 2.0 * Math.random() - 1.0;
        // normal vector
        let theta = Math.random() * 2.0 * Math.PI;
        let phi = Math.acos(2.0 * Math.random() - 1.0);
        vbuffer[7 * i + 3] = Math.cos(phi);
        vbuffer[7 * i + 4] = Math.sin(phi) * Math.cos(theta);
        vbuffer[7 * i + 5] = Math.sin(phi) * Math.sin(theta);
        // size
        vbuffer[7 * i + 6] = 0.05 + 0.09 * Math.random();
    }
    return vbuffer;
}

function loadMesh(fileContent, normalize = false, scale = 1.0) {
    let decoder = new TextDecoder();
    let getNext = (data, sep) => {
        //console.log(data);
        let next = data.indexOf(sep.charCodeAt(0));
        let str;
        if (next != -1) {
            str = decoder.decode(data.subarray(0, next+1));
        } else {
            str = decoder.decode(data.subarray(0));
        }
        data = data.subarray(next+1);
        return { val: parseFloat(str), rest: data };
    };

    let numVertices, numFaces, data;
    ({val: numVertices, rest: data} = getNext(fileContent, " "));
    ({val: numFaces, rest: data} = getNext(data, "\n"));

    let center = [0.0, 0.0, 0.0];
    let aabbMin = [Infinity, Infinity, Infinity];
    let aabbMax = [-Infinity, -Infinity, -Infinity];

    let val;
    let vertices = new Float32Array(7 * numVertices);
    for (let i = 0; i < numVertices; i++) {
        for (let j = 0; j < 7; j++) {
            ({val, rest: data} = getNext(data, j == 6 ? "\n" : " "));
            vertices[7 * i + j] = val;
        }

        if (normalize) {
            for (let j = 0; j < 3; j++) {
                center[j] += vertices[7 * i + j];
                aabbMin[j] = Math.min(aabbMin[j], vertices[7 * i + j]);
                aabbMax[j] = Math.max(aabbMax[j], vertices[7 * i + j]);
            }
        }
    }

    if (normalize) {
        for (let j = 0; j < 3; j++) {
            center[j] /= numVertices;
        }
        let s = scale / Math.max(aabbMax[0] - aabbMin[0], aabbMax[1] - aabbMin[1], aabbMax[2] - aabbMin[2]);

        for (let i = 0; i < numVertices; i++) {
            for (let j = 0; j < 3; j++) {
                vertices[7 * i + j] = s * (vertices[7 * i + j] - center[j]);
            }
            vertices[7 * i + 6] = s * vertices[7 * i + 6];
        }
    }
    
    let indices = new Uint32Array(3 * numFaces);
    for (let i = 0; i < numFaces; i++) {
        for (let j = 0; j < 3; j++) {
            ({val, rest: data} = getNext(data, j == 2 ? "\n" : " "));
            indices[3 * i + j] = val;
        }
    }

    return {vertices, indices};
}

function createQuads(device, pointCloud, sizeFactor = 1.0) {
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

    let numPoints = pointCloud.length / 7;
    let corners = new Float32Array(4 * numPoints * 8);
    let triPairs = new Uint32Array(numPoints * 6);
    let cornerPos = new Float32Array(3);
    for (let i = 0; i < numPoints; i++) {
        let point = pointCloud.subarray(7 * i, 7 * i + 3);
        let normal = pointCloud.subarray(7 * i + 3, 7 * i + 6);
        makeNormalMat(normal);
        const offsets = [ [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5] ];
        for (let j = 0; j < 4; j++) {
            let size = sizeFactor * pointCloud[7 * i + 6];
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
    
    let vbuffer = device.createBuffer({ label: "CornerBufferFull", size: corners.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, });
    device.queue.writeBuffer(vbuffer, 0, corners);

    let ibuffer = device.createBuffer({ label: "QuadIndices", size: triPairs.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, });
    device.queue.writeBuffer(ibuffer, 0, triPairs);

    return { vbuffer, ibuffer };
}

function createPartialQuads(device, pointCloud) {
    let numPoints = pointCloud.length / 7;
    let corners = new Float32Array(4 * numPoints * 9);
    let triPairs = new Uint32Array(numPoints * 6);
    let cornerPos = new Float32Array(3);
    for (let i = 0; i < numPoints; i++) {
        let point = pointCloud.subarray(7 * i, 7 * i + 3);
        let normal = pointCloud.subarray(7 * i + 3, 7 * i + 6);
        const offsets = [ [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5] ];
        for (let j = 0; j < 4; j++) {
            let size = pointCloud[7 * i + 6];
            corners[7 * (4 * i + j) + 0] = point[0];
            corners[7 * (4 * i + j) + 1] = point[1];
            corners[7 * (4 * i + j) + 2] = point[2];
            corners[7 * (4 * i + j) + 3] = normal[0];
            corners[7 * (4 * i + j) + 4] = normal[1];
            corners[7 * (4 * i + j) + 5] = normal[2];
            // corners[9 * (4 * i + j) + 6] = 2.0 * offsets[j][0];
            // corners[9 * (4 * i + j) + 7] = 2.0 * offsets[j][1];
            corners[7 * (4 * i + j) + 6] = size;
        }
    }
    
    let vbuffer = device.createBuffer({ label: "CornerBufferFull", size: corners.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, });
    device.queue.writeBuffer(vbuffer, 0, corners);

    return vbuffer;
}

// Storage buffer, contrary to vertex  buffers have stricter alignment requirements
// We shuffled the fields around to reduce holes in the structure
function createPointCloudStorageBuffer(device, pointCloud) {
    let numPoints = pointCloud.length / 7;
    let points = new Float32Array(numPoints * 8); // 1 byte of padding
    for (let i = 0; i < numPoints; i++) {
        // position in [-1.0, 1.0[
        points[8 * i + 0] = pointCloud[7 * i + 0]; 
        points[8 * i + 1] = pointCloud[7 * i + 1];
        points[8 * i + 2] = pointCloud[7 * i + 2];
        // size
        points[8 * i + 3] = pointCloud[7 * i + 6];
        // normal vector
        points[8 * i + 4] = pointCloud[7 * i + 3];
        points[8 * i + 5] = pointCloud[7 * i + 4];
        points[8 * i + 6] = pointCloud[7 * i + 5];
    }
    let buffer = device.createBuffer({ label: "PointCloudStorage", size: points.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, points);

    return buffer;
}

var shaderRegistry;

class Pass {
    constructor(context, shaderCode) {
        this.context = context.context;
        this.device = context.device;

        let device = context.device;
        this.module = device.createShaderModule({ code: shaderCode });
    }
}

class DilationPass extends Pass {
    constructor(context, srcTexture) {
        super(context, shaderRegistry["dilate.wgsl"]);

        let device = this.device;

        // struct FilterParam {
        //     size: u32,
        //     bg_color: vec4f,
        // }
        // (note: size is 32 because of padding, due to vec4f alignment requirements)
        this.uniformBuffer = device.createBuffer({size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.FRAGMENT | GPUBufferUsage.COPY_DST});
        
        this.pointSize = 5;
        this.bg_color = [0.0, 0.0, 0.0, 1.0];

        this.pipeline = device.createRenderPipeline({
            label: "Dilation Pipeline",
            vertex: { module: this.module, entryPoint: "vs" },
            fragment: { module: this.module, entryPoint: "fs", targets: [{ format: "bgra8unorm" }] },
            primitive: { topology: "triangle-list" },
            layout: "auto",
        });

        this.bindGroup = device.createBindGroup({
            label: "Dilation bind group",
            entries: [
                { binding: 0, resource: srcTexture.createView() },
                { binding: 1, resource: { buffer: this.uniformBuffer } }
            ],
            layout: this.pipeline.getBindGroupLayout(0)
        });
    }

    run(encoder) {
        let pass = encoder.beginRenderPass({
            label: "Dilation Pass",
            colorAttachments: [
                {
                    loadOp: "clear",
                    storeOp: "store",
                    view: this.context.getCurrentTexture().createView(),
                },
            ]
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3);
        pass.end();
    }

    set pointSize(size) {
        this.device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([size]));
    }

    set bg_color(color) {
        this.device.queue.writeBuffer(this.uniformBuffer, 16, new Float32Array(color));
    }
}

function createPipeline(device, label, vsEntryPoint, topology, additionnalAttribs, additionnalStride, instanced, needDepth, offscreen = false, noVBuffer = false) {
        const module = device.createShaderModule({ code: shaderRegistry["mesh.wgsl"] });
        
        let format = offscreen ? "rgba8unorm" :  navigator.gpu.getPreferredCanvasFormat();

        let depthStencil = undefined;
        if (needDepth) {
            depthStencil = {
               depthWriteEnabled: true,
               depthCompare: "less",
               format: "depth32float" 
            };
        }

        const pipeline = device.createRenderPipeline({
            label,
            vertex: {
                module,
                entryPoint: vsEntryPoint,
                buffers : noVBuffer ? [] : [
                    {
                        arrayStride: 24 + additionnalStride,
                        attributes: [
                            { format: "float32x3", offset: 0, shaderLocation: 0 },
                            { format: "float32x3", offset: 12, shaderLocation: 1 },
                        ].concat(additionnalAttribs),
                        stepMode: instanced ? "instance" : "vertex"
                    },
                ]
            },
            fragment: {
                module,
                entryPoint: "fragmentMain",
                targets: [{ format }],
            },
            primitive: {
                topology,
                cullMode: "back"
            },
            depthStencil,
            layout: "auto",
        });

        return pipeline;
}

let initComplete = [setupCanvas("webgpu-canvas")].concat([meshFileContent]).concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context, canvas } = results[0];

    let meshContent = results[1];

    // turn the loaded shader text into a dict, keyed by the filename
    let shaders = results.slice(2).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    shaderRegistry = shaders;

    const shaderModule = device.createShaderModule({ code: shaders["mesh.wgsl"] });
    const dilationShaderModule = device.createShaderModule({ code: shaders["dilate.wgsl"] });

    let bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
        ],
    });

    let pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout, bindGroupLayout],
    });

    let pointSize = 1.0;
    let renderMethod = "points";
    //let pointCloud = createPointCloud(numPoints);

    let {vertices: pointCloud, indices} = loadMesh(meshContent, true, 3.0);
    let numPoints = pointCloud.length / 7;

    let pointBuffer = device.createBuffer({
        label: "PointBuffer",
        size: pointCloud.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(pointBuffer, 0, pointCloud);

    let { vbuffer: quadVertBuffer1, ibuffer: quadIndBuffer } = createQuads(device, pointCloud, pointSize);
    let quadVertBuffer2 = createPartialQuads(device, pointCloud);

    let zbuffer = device.createTexture({ format: "depth32float", size: [canvas.width, canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView();
    const pointPipeline = createPipeline(device, "PointPipeline", "vertexMain", "point-list", [], 4, false, false, true);

    const uvAttribs = [{ format: "float32x2", offset: 24, shaderLocation: 2 }];
    const quadPipeline = createPipeline(device, "QuadPipeline", "vsQuad", "triangle-list", uvAttribs, 8, false, true, false);
    
    const sizeAttrib = [
        { format: "float32", offset: 24, shaderLocation: 2 },
    ];
    const quadPipeline2 = createPipeline(device, "QuadPipeline2", "vsQuad2", "triangle-list", sizeAttrib, 4, false, true, false);

    const instPipeline = createPipeline(device, "InstancingPipeline", "vsQuad3", "triangle-list", sizeAttrib, 4, true, true, false);
    let singleQuad = new Uint32Array([0, 1, 2, 1, 3, 2]);
    let singleQuadIBuffer = device.createBuffer({
        label: "SingleQuadBuffer",
        size: singleQuad.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(singleQuadIBuffer, 0, singleQuad);

    let pointStorageBuffer = createPointCloudStorageBuffer(device, pointCloud);
    const sbPipeline = createPipeline(device, "StorageBufferPipeline", "vsQuad4", "triangle-list", [], 0, false, true, false, true);

    // SceneData layout (offset, size)
    //  | scene: (0, 224)
    //  | camera: (0, 192)
    //  |   camera.view: (0, 64)
    //  |   camera.inv_view: (64, 64)
    //  |   camera.proj: (128, 64)
    //  | light: (192, 32)
    //  |   light.position: (192, 12)   // 4-bytes padding
    //  |   light.color: (208, 12)      // 4-bytes padding

    let sceneData = new ArrayBuffer(224);
    let viewMat = new Float32Array(sceneData, 0, 16);
    let invViewMat = new Float32Array(sceneData, 64, 16);
    let projMat = new Float32Array(sceneData, 128, 16);
    let lightPos = new Float32Array(sceneData, 192, 3);
    let lightColor = new Float32Array(sceneData, 208, 3);

    let pov = { theta: 0.0, phi: radians(60), dist: 10.0 };
    updateViewMats(viewMat, invViewMat, pov);
    mat4.invert(invViewMat, viewMat);
    mat4.perspective(projMat, (Math.PI / 180.0) * 30, canvas.width / canvas.height, 0.1, 1000.0); 

    lightPos[0] = 1.0;
    lightPos[1] = 3.0;
    lightPos[2] = 1.0;

    lightColor[0] = 1.0;
    lightColor[1] = 1.0;
    lightColor[2] = 1.0;

    // MeshData layout
    // | mesh: (0, 144)
    // |   model: (0, 64)
    // |   inv_model: (64, 64)
    // |   color: (128, 16)
    // |   size_factor: (144, 4)  <- padding + 12
    let meshData = new ArrayBuffer(160);
    let modelMat = new Float32Array(meshData, 0, 16);
    let invModelMat = new Float32Array(meshData, 64, 16);
    let meshColor = new Float32Array(meshData, 128, 4);
    let pointSizeFactor = new Float32Array(meshData, 144, 1);

    mat4.identity(modelMat);
    mat4.invert(invModelMat, modelMat);

    meshColor[0] = 0.8;
    meshColor[1] = 0.8;
    meshColor[2] = 1.0;
    meshColor[3] = 1.0;

    pointSizeFactor[0] = 1.0;

    let sceneDataBuffer = device.createBuffer({
        label: "SceneData",
        size: sceneData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(sceneDataBuffer, 0, sceneData);

    let meshDataBuffer = device.createBuffer({
        label: "MeshData",
        size: meshData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(meshDataBuffer, 0, meshData);

    let sceneGroup = device.createBindGroup({ entries: [ { binding: 0, resource: { buffer: sceneDataBuffer }, }, ], layout: pointPipeline.getBindGroupLayout(0), });
    let meshGroup = device.createBindGroup({ entries: [ { binding: 0, resource: { buffer: meshDataBuffer }, }, ], layout: pointPipeline.getBindGroupLayout(1), });

    // fot the storage buffer pipeline
    let meshGroupExtended = device.createBindGroup({
        entries: [
            { binding: 0, resource: { buffer: meshDataBuffer }, }, 
            { binding: 1, resource: { buffer: pointStorageBuffer }, }, 
        ],
        layout: sbPipeline.getBindGroupLayout(1)
    });

    let pointRasterTexture = device.createTexture({
        format: "rgba8unorm",
        size: [ canvas.width, canvas.height ],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    let pointRasterTextureView = pointRasterTexture.createView();

    let bg_color = [1.0, 1.0, 1.0, 1.0];
    let dilationPass = new DilationPass({context, device}, pointRasterTexture);
    dilationPass.bg_color = bg_color;

    let update = () => {
        device.queue.writeBuffer(sceneDataBuffer, 0, sceneData);

        const encoder = device.createCommandEncoder({ label: "myEncoder" });

        switch (renderMethod) {
            case "points": {
                let pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            clearValue: bg_color,
                            loadOp: "clear",
                            storeOp: "store",
                            view: pointRasterTextureView,
                        },
                    ]
                });

                pass.setPipeline(pointPipeline);
                pass.setBindGroup(0, sceneGroup);
                pass.setBindGroup(1, meshGroup);
                pass.setVertexBuffer(0, pointBuffer);

                pass.draw(numPoints);
                pass.end();

                // dilation pass
                dilationPass.run(encoder);
                break;
            }
            case "quads_cpu": {
                let pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            clearValue: bg_color,
                            loadOp: "clear",
                            storeOp: "store",
                            view: context.getCurrentTexture().createView(),
                        },
                    ],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,

                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        view: zbuffer
                    }
                });

                pass.setPipeline(quadPipeline);
                pass.setBindGroup(0, sceneGroup);
                pass.setBindGroup(1, meshGroup);
                pass.setVertexBuffer(0, quadVertBuffer1);
                pass.setIndexBuffer(quadIndBuffer, "uint32");

                pass.drawIndexed(6 * numPoints);

                pass.end();

                break;
            }
            case "quads_gpu": {
                let pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            clearValue: bg_color,
                            loadOp: "clear",
                            storeOp: "store",
                            view: context.getCurrentTexture().createView(),
                        },
                    ],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        view: zbuffer
                    }
                });

                pass.setPipeline(quadPipeline2);
                pass.setBindGroup(0, sceneGroup);
                pass.setBindGroup(1, meshGroup);
                pass.setVertexBuffer(0, quadVertBuffer2);
                pass.setIndexBuffer(quadIndBuffer, "uint32");

                pass.drawIndexed(6 * numPoints);

                pass.end();

                break;
            }
            case "instancing": {
                let pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            clearValue: bg_color,
                            loadOp: "clear",
                            storeOp: "store",
                            view: context.getCurrentTexture().createView(),
                        },
                    ],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        view: zbuffer
                    }
                });

                pass.setPipeline(instPipeline);
                pass.setBindGroup(0, sceneGroup);
                pass.setBindGroup(1, meshGroup);
                pass.setVertexBuffer(0, pointBuffer);
                pass.setIndexBuffer(singleQuadIBuffer, "uint32");

                pass.drawIndexed(6, numPoints);

                pass.end();

                break;
            }
            case "storage_buffers": {
                let pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            clearValue: bg_color,
                            loadOp: "clear",
                            storeOp: "store",
                            view: context.getCurrentTexture().createView(),
                        },
                    ],
                    depthStencilAttachment: {
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                        view: zbuffer
                    }
                });

                pass.setPipeline(sbPipeline);
                pass.setBindGroup(0, sceneGroup);
                pass.setBindGroup(1, meshGroupExtended);
                pass.setIndexBuffer(singleQuadIBuffer, "uint32");

                pass.drawIndexed(6, numPoints);

                pass.end();

                break;
            }
            default: break;
        }

        let commands = encoder.finish({ label: "commandBuffer" });
        device.queue.submit([commands]);
 
        window.requestAnimationFrame(update);
    };

    window.requestAnimationFrame(update);

    let povAction = { active: false, x: 0.0, y: 0.0, theta0: pov.theta, phi0: pov.phi };
    canvas.addEventListener("mousedown", (event) => {
        if (event.button == 0) {
            povAction.active = true;
            povAction.x = event.pageX;
            povAction.y = event.pageY;
            povAction.theta0 = pov.theta;
            povAction.phi0 = pov.phi;
        }
    });

    window.addEventListener("mouseup", (event) => {
        if (event.button == 0) {
            povAction.active = false;
        }
    });

    window.addEventListener("mousemove", (event) => {
        if (povAction.active) {
            let dx = event.pageX - povAction.x;
            let dy = event.pageY - povAction.y;

            pov.theta = povAction.theta0 + (dx * CAM_ROT_THETA_PER_PIXELS);
            pov.theta = pov.theta % (2.0 * Math.PI);
            if (pov.theta < 0.0) {
                pov.theta = (2.0 * Math.PI) + pov.theta;
            }
            pov.phi = clamp(povAction.phi0 - (dy * CAM_ROT_PHI_PER_PIXELS), 1e-6, Math.PI - 1e-6);

            updateViewMats(viewMat, invViewMat, pov);
        }
    });

    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();

        pov.dist += 0.01 * event.deltaY;
        pov.dist = Math.max(0.5, pov.dist);
        updateViewMats(viewMat, invViewMat, pov);
    });

    document.getElementById("point-width").addEventListener("input", (event) => {
        pointSize = event.target.value;
        
        let pw = Math.max(1.0, Math.ceil(5 * pointSize));
        dilationPass.pointSize = pw;
    
        if (renderMethod == "quads_cpu") {
            quadVertBuffer1.destroy();
            quadIndBuffer.destroy();
            ({ vbuffer: quadVertBuffer1, ibuffer: quadIndBuffer } = createQuads(device, pointCloud, pointSize));
        }

        //if (renderMethod == "quads_gpu") {
            pointSizeFactor[0] = pointSize;
            device.queue.writeBuffer(meshDataBuffer, 0, meshData);
        //}
        
    });
    
    document.getElementById("method").addEventListener("input", (event) => {
        renderMethod = event.target.value;

        if (renderMethod == "quads_cpu") {
            quadVertBuffer1.destroy();
            quadIndBuffer.destroy();
            ({ vbuffer: quadVertBuffer1, ibuffer: quadIndBuffer } = createQuads(device, pointCloud, pointSize));
        }

        if (renderMethod == "points") {
            let pw = Math.max(1.0, Math.ceil(5 * pointSize));
            dilationPass.pointSize = pw;
        }
    });
});
