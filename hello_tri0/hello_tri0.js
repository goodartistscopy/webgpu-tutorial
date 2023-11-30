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

    return { device, context };
}

const shaderFiles = ["triangle.wgsl"];

let shaderSources = shaderFiles.map((file) => {
    return fetch(file, { cache: "no-cache" })
        .then((response) => response.text())
        .then((text) => ({ file, text }));
});

let initComplete = [setupCanvas("webgpu-canvas")].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context } = results[0];

    // Turn the loaded shader text into a dict, keyed by the filename
    shaders = results.slice(1).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    //=== Create the shader module
    const shaderModule = device.createShaderModule({
        code: shaders["triangle.wgsl"],
    });

    //=== Create a pipeline
    const pipeline = device.createRenderPipeline({
        label: "BasicPipeline",
        vertex: {
            // looks like override constants are Chrome only for now
            //constants: { scale: 1.0 },
            module: shaderModule,
            entryPoint: "vertexMain",
        },
        fragment: {
            //constants: { scale: 1.0 },
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [
                {
                    format: "bgra8unorm",
                },
            ],
        },
        primitive: {
            cullMode: "back",
            frontFace: "ccw",
            topology: "triangle-list",
        },
        layout: "auto",
    });

    //=== Now we submit a simple drawing command
    //  Encoder -> RenderPass -> Draw commands -> Command Buffer -> Queue submission
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
    });

    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();

    let commands = encoder.finish({ label: "commandBuffer" });

    device.queue.submit([commands]);
});
