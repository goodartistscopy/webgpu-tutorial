// For Firefox you need to comment the end of mesh.wgsl (from the declaration of video_texture)

import { vec3, mat4 } from "../ext/gl-matrix/dist/esm/index.js";

//  Change this vaalue for different behavior
// 1, 2, 3: static textures
// 4: external texture from a video element (unsupported on Firefox)
const TEST = 3;
const USE_WEBCAM = true; // for TEST == 4 only

const shaderFiles = ["mesh.wgsl"];
const CAM_ROT_PHI_PER_PIXELS = radians(0.25);
const CAM_ROT_THETA_PER_PIXELS = radians(0.25);
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

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

async function loadImageBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

// Adapted from https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
async function waitForVideo(video, useWebcam = false) {
    if (useWebcam) {
        await navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                video.srcObject = stream;
            });
    }
    return new Promise((resolve, reject) => {
            video.addEventListener('error', reject);
            if ('requestVideoFrameCallback' in video) {
                video.requestVideoFrameCallback(resolve);
            } else {
                const timeWatcher = () => {
                    if (video.currentTime > 0) {
                        resolve();
                    } else {
                        requestAnimationFrame(timeWatcher);
                    }
                };
                timeWatcher();
            }
            // only play with live video, files require a document interaction
            if (useWebcam) {
                video.play().catch(reject);
            }
        });
}

function updateViewMats(mat, invMat, pov) {
    let eye = [Math.sin(pov.phi) * Math.cos(pov.theta), Math.cos(pov.phi), Math.sin(pov.phi) * Math.sin(pov.theta)];
    vec3.scale(eye, eye, pov.dist);
    let up = [0.0, 1.0, 0.0];
    mat4.lookAt(mat, eye, [0.0, 0.0, 0.0], up);
    mat4.invert(invMat, mat);
}

let initComplete = [setupCanvas("webgpu-canvas")]
    .concat(createImageBitmap(document.getElementById("texture")))
    .concat(loadImageBitmap("./data/capybara.jpg"))
    .concat(waitForVideo(document.getElementById("video"), USE_WEBCAM && (TEST == 4)))
    .concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context, canvas } = results[0];

    // turn the loaded shader text into a dict, keyed by the filename
    let shaders = results.slice(4).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    let vertices = Float32Array.from([
        // position           normal         tex coords
        -1.0, -1.0, -1.0,  -1.0, 0.0, 0.0,   0.0, 1.0,
        -1.0, -1.0, -1.0,   0.0, -1.0, 0.0,  0.0, 1.0,
        -1.0, -1.0, -1.0,   0.0, 0.0, -1.0,  1.0, 1.0,

        1.0, -1.0, -1.0,    1.0, 0.0, 0.0,   1.0, 1.0,
        1.0, -1.0, -1.0,    0.0, -1.0, 0.0,  1.0, 1.0,
        1.0, -1.0, -1.0,    0.0, 0.0, -1.0,  0.0, 1.0,

        1.0, 1.0, -1.0,     1.0, 0.0, 0.0,   1.0, 0.0,
        1.0, 1.0, -1.0,     0.0, 1.0, 0.0,   1.0, 0.0,
        1.0, 1.0, -1.0,     0.0, 0.0, -1.0,  0.0, 0.0,

        -1.0, 1.0, -1.0,   -1.0, 0.0, 0.0,   0.0, 0.0,
        -1.0, 1.0, -1.0,    0.0, 1.0, 0.0,   0.0, 0.0,
        -1.0, 1.0, -1.0,    0.0, 0.0, -1.0,  1.0, 0.0,

        -1.0, -1.0, 1.0,   -1.0, 0.0, 0.0,   1.0, 1.0,
        -1.0, -1.0, 1.0,    0.0, -1.0, 0.0,  0.0, 0.0,
        -1.0, -1.0, 1.0,    0.0, 0.0, 1.0,   0.0, 1.0,

        1.0, -1.0, 1.0,     1.0, 0.0, 0.0,   0.0, 1.0,
        1.0, -1.0, 1.0,     0.0, -1.0, 0.0,  1.0, 0.0,
        1.0, -1.0, 1.0,     0.0, 0.0,  1.0,  1.0, 1.0,

        1.0, 1.0, 1.0,      1.0, 0.0, 0.0,   0.0, 0.0,
        1.0, 1.0, 1.0,      0.0, 1.0, 0.0,   1.0, 1.0,
        1.0, 1.0, 1.0,      0.0, 0.0, 1.0,   1.0, 0.0,

        -1.0, 1.0, 1.0,    -1.0, 0.0, 0.0,   1.0, 0.0,
        -1.0, 1.0, 1.0,     0.0, 1.0, 0.0,   0.0, 1.0,
        -1.0, 1.0, 1.0,     0.0, 0.0, 1.0,   0.0, 0.0,
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

    // Bind group layouts group 0: scene data
    //                    group 1: mesh data
    let bindGroup0Layout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
        ],
    });

    let bindGroup1Layout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {dimension: "2d", format: "rgba8unorm", size: [3, 3]} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {type: "filtering"} },
        ],
    });

    let texture, textureExt;
    switch (TEST) {
        // 1 - Manually constructed texture
        case 1: {
            texture = device.createTexture({ format: "rgba8unorm", size: [3, 3], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
            let textureData = new Uint8Array(
                [ RED, BLUE, GREEN,
                  BLACK, WHITE, BLACK,
                  BLUE, RED, BLUE ].flat()
            );
            device.queue.writeTexture({texture}, textureData, {bytesPerRow: 12}, {width:3, height:3});
        }    
        break;

        // 2 - Loaded from an HTMLImageElement
        case 2: {
            let textureData = results[1];
            texture = device.createTexture({ format: "rgba8unorm", size: [textureData.width, textureData.height],
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.RENDER_ATTACHMENT // <-- note this
            });
            device.queue.copyExternalImageToTexture(
                { source: textureData, flipY: false },
                { texture },
                [textureData.width, textureData.height], // or object {width:..., height:...}
            );
        }
        break;
        // 3 - Loaded from an URL
        case 3: {
            let textureData = results[2];
            texture = device.createTexture({ format: "rgba8unorm", size: [textureData.width, textureData.height],
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.RENDER_ATTACHMENT // <-- note this, its required by copyExternalImageToTexture()
            });
            device.queue.copyExternalImageToTexture(
                { source: textureData, flipY: false },
                { texture },
                [textureData.width, textureData.height], // or object {width:..., height:...}
            );
        }
        break;
        // 4 - import from a video element
        case 4: {
            // we need to patch the binding group a little bit
            bindGroup1Layout = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
                    { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },  // <- here
                    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {type: "filtering"} },
                ],
            });
        }
        break;
    }

    let sampler = device.createSampler({
        addressModeU: "repeat",
        addressModeV: "repeat",
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "linear" // fyi, but irrelevant here
    });

    const shaderModule = device.createShaderModule({ code: shaders["mesh.wgsl"] });
    let pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroup0Layout, bindGroup1Layout],
    });

    const pipeline = device.createRenderPipeline({
        label: "BasicPipeline",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers : [
                {
                    arrayStride: 32,
                    attributes: [
                        { format: "float32x3", offset: 0, shaderLocation: 0 },
                        { format: "float32x3", offset: 12, shaderLocation: 1 },
                        { format: "float32x2", offset: 24, shaderLocation: 2 },
                    ],
                },
            ]
        },
        fragment: {
            module: shaderModule,
            entryPoint: (TEST == 4)? "fragmentVideoMain" : "fragmentMain",
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
    // | mesh: (0, 160)
    // |   model: (0, 64)
    // |   inv_model: (64, 64)
    // |   color: (128, 16)
    // |   video_aspect: (144, 4) // +12 bytes stride
    let meshData = new ArrayBuffer(160);
    let modelMat = new Float32Array(meshData, 0, 16);
    let invModelMat = new Float32Array(meshData, 64, 16);
    let meshColor = new Float32Array(meshData, 128, 4);
    let videoAspect = new Float32Array(meshData, 144, 1);

    mat4.identity(modelMat);
    mat4.invert(invModelMat, modelMat);

    meshColor[0] = 1.0;
    meshColor[1] = 0.0;
    meshColor[2] = 0.0;
    meshColor[3] = 1.0;

    if (TEST == 4) {
        let video = document.getElementById("video");
        videoAspect[0] = video.videoWidth / video.videoHeight;
    } else {
        videoAspect[0] = 1.0;
    }

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
            { binding: 0, resource: { buffer: sceneDataBuffer } },
        ],
        layout: pipeline.getBindGroupLayout(0),
    });

    var meshGroup;
    if (TEST != 4) {
        meshGroup = device.createBindGroup({
        entries: [
            { binding: 0, resource: { buffer: meshDataBuffer } },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: sampler }
        ],
        layout: pipeline.getBindGroupLayout(1),
    });
    }

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

        if (TEST == 4) {
            // The video element gives a new texture each frame that we need to bind.
            // We could be more clever and test that the texture is actually new,
            // and avoid recreating a bind group each (screen) frame.
            let video = document.getElementById('video');
            textureExt = device.importExternalTexture({
                source: video
            });

            meshGroup = device.createBindGroup({
                entries: [
                    { binding: 0, resource: { buffer: meshDataBuffer } },
                    { binding: 1, resource: textureExt},
                    { binding: 2, resource: sampler }
                ],
                layout: pipeline.getBindGroupLayout(1),
            });
        }

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
