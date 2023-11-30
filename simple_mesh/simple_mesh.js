import { vec3, mat4 } from "../ext/gl-matrix/dist/esm/index.js";

const shaderFiles = ["mesh.wgsl"];
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
        .then((response) => response.text())
        .then((text) => ({ file, text }));
});

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

let initComplete = [setupCanvas("webgpu-canvas")].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context, canvas } = results[0];

    // turn the loaded shader text into a dict, keyed by the filename
    let shaders = results.slice(1).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    const shaderModule = device.createShaderModule({ code: shaders["mesh.wgsl"] });

    let bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
        ],
    });

    let pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout, bindGroupLayout],
    });

    let vertices = Float32Array.from([
        // position           normal          tex coords
        -1.0, -1.0, -1.0,  -1.0, 0.0, 0.0,   //  0.0, 1.0,
        -1.0, -1.0, -1.0,   0.0, -1.0, 0.0,  //  0.0, 1.0,
        -1.0, -1.0, -1.0,   0.0, 0.0, -1.0,  //  1.0, 1.0,

        1.0, -1.0, -1.0,    1.0, 0.0, 0.0,   //  1.0, 1.0,
        1.0, -1.0, -1.0,    0.0, -1.0, 0.0,  //  1.0, 1.0,
        1.0, -1.0, -1.0,    0.0, 0.0, -1.0,  //  0.0, 1.0,

        1.0, 1.0, -1.0,     1.0, 0.0, 0.0,   //  1.0, 0.0,
        1.0, 1.0, -1.0,     0.0, 1.0, 0.0,   //  1.0, 0.0,
        1.0, 1.0, -1.0,     0.0, 0.0, -1.0,  //  0.0, 0.0,

        -1.0, 1.0, -1.0,   -1.0, 0.0, 0.0,   //  0.0, 0.0,
        -1.0, 1.0, -1.0,    0.0, 1.0, 0.0,   //  0.0, 0.0,
        -1.0, 1.0, -1.0,    0.0, 0.0, -1.0,  //  1.0, 0.0,

        -1.0, -1.0, 1.0,   -1.0, 0.0, 0.0,   //  1.0, 1.0,
        -1.0, -1.0, 1.0,    0.0, -1.0, 0.0,  //  0.0, 0.0,
        -1.0, -1.0, 1.0,    0.0, 0.0, 1.0,   //  0.0, 1.0,

        1.0, -1.0, 1.0,     1.0, 0.0, 0.0,   //  0.0, 1.0,
        1.0, -1.0, 1.0,     0.0, -1.0, 0.0,  //  1.0, 0.0,
        1.0, -1.0, 1.0,     0.0, 0.0,  1.0,  //  1.0, 1.0,

        1.0, 1.0, 1.0,      1.0, 0.0, 0.0,   //  0.0, 0.0,
        1.0, 1.0, 1.0,      0.0, 1.0, 0.0,   //  1.0, 1.0,
        1.0, 1.0, 1.0,      0.0, 0.0, 1.0,   //  1.0, 0.0,

        -1.0, 1.0, 1.0,    -1.0, 0.0, 0.0,   //  1.0, 0.0,
        -1.0, 1.0, 1.0,     0.0, 1.0, 0.0,   //  0.0, 1.0,
        -1.0, 1.0, 1.0,     0.0, 0.0, 1.0,   //  0.0, 0.0,
    ]);

    let vBuffer = device.createBuffer({
        label: "VertexBuffer",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vBuffer, 0, vertices);

    let indices = Uint16Array.from([
        2, 8, 5,
        2, 11, 8,
        15, 3, 6,
        15, 6, 18,
        14, 17, 20,
        14, 20, 23,
        12, 9, 0,
        12, 21, 9,
        1, 4, 16,
        1, 16, 13,
        10, 22, 19,
        10, 19, 7,
    ]);
    let iBuffer = device.createBuffer({
        label: "IndexBuffer",
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(iBuffer, 0, indices);

    let zbuffer = device.createTexture({ format: "depth32float", size: [canvas.width, canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView();

    const pipeline = device.createRenderPipeline({
        label: "BasicPipeline",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers : [
                {
                    arrayStride: 24,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                    ],
                },
            ]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: "bgra8unorm" }],
        },
        primitive: {
            cullMode: "back",
        },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: "less",
            format: "depth32float"
        },
        //layout: "auto",
        layout: pipelineLayout
    });

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

    lightPos[0] = 0.0;
    lightPos[1] = 3.0;
    lightPos[2] = 0.0;

    lightColor[0] = 1.0;
    lightColor[1] = 1.0;
    lightColor[2] = 1.0;

    // MeshData layout
    // | mesh: (0, 144)
    // |   model: (0, 64)
    // |   inv_model: (64, 64)
    // |   color: (128, 16)
    let meshData = new ArrayBuffer(144);
    let modelMat = new Float32Array(meshData, 0, 16);
    let invModelMat = new Float32Array(meshData, 64, 16);
    let meshColor = new Float32Array(meshData, 128, 4);

    mat4.identity(modelMat);
    mat4.invert(invModelMat, modelMat);

    meshColor[0] = 1.0;
    meshColor[1] = 0.0;
    meshColor[2] = 0.0;
    meshColor[3] = 1.0;

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

    let sceneGroup = device.createBindGroup({
        entries: [
            {
                binding: 0,
                resource: { buffer: sceneDataBuffer },
            },
        ],
        layout: pipeline.getBindGroupLayout(0),
    });

    let meshGroup = device.createBindGroup({
        entries: [
            {
                binding: 0,
                resource: { buffer: meshDataBuffer },
            },
        ],
        layout: pipeline.getBindGroupLayout(1),
    });

    let angle = 0.0;
    let update = () => {
        // update light position
        angle += radians(1.0);
        angle = angle % (2.0 * Math.PI);
        lightPos[0] = 3.0 * Math.cos(angle);
        lightPos[1] = 4.0;
        lightPos[2] = 3.0 * Math.sin(angle);
        device.queue.writeBuffer(sceneDataBuffer, 0, sceneData);

        const encoder = device.createCommandEncoder({ label: "myEncoder" });
        const pass = encoder.beginRenderPass({
            label: "mainPass",
            colorAttachments: [
                {
                    clearValue: [0.1, 0.3, 0.7, 1.0],
                    loadOp: "clear",
                    storeOp: "store",
                    view: context.getCurrentTexture().createView(),
                },
            ],
            depthStencilAttachment: {
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                view: zbuffer,
            }
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, sceneGroup);
        pass.setBindGroup(1, meshGroup);
        pass.setVertexBuffer(0, vBuffer);
        pass.setIndexBuffer(iBuffer, "uint16");

        pass.drawIndexed(indices.length);
        pass.end();

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

});
