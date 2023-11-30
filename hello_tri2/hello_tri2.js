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

const shaderFiles = ["triangle_rot.wgsl"];

let shaderSources = shaderFiles.map((file) => {
    return fetch(file, { cache: "no-cache" })
        .then((response) => response.text())
        .then((text) => ({ file, text }));
});

let initComplete = [setupCanvas("webgpu-canvas")].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context } = results[0];

    // turn the loaded shader text into a dict, keyed by the filename
    shaders = results.slice(1).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    const shaderModule = device.createShaderModule({
        code: shaders["triangle_rot.wgsl"],
    });

    let bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {} },
        ],
    });

    let pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
        label: "BasicPipeline",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: "bgra8unorm" }],
        },
        layout: "auto",
        //layout: pipelineLayout
    });

    let colorData = new Float32Array([1.0, 0.0, 0.0, 1.0]);
    let colorBuffer = device.createBuffer({
        label: "colorBuffer",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, 0, colorData);

    let angleData = new Float32Array([1.0]);
    let angleBuffer = device.createBuffer({
        label: "angleBuffer",
        size: 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(angleBuffer, 0, angleData);

    let bindGroup = device.createBindGroup({
        entries: [
            {
                binding: 0,
                resource: { buffer: colorBuffer },
            },
            {
                binding: 1,
                resource: { buffer: angleBuffer },
            },
        ],
        //layout: bindGroupLayout,
        layout: pipeline.getBindGroupLayout(0),
    });

    let angle = 0.0;
    let update = () => {
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
        pass.setBindGroup(0, bindGroup);

        let angleData2 = new Float32Array([angle]);
        device.queue.writeBuffer(angleBuffer, 0, angleData2);
        angle += 0.01;
        if (angle > 6.28) {
            angle = 0.0;
        }

        pass.draw(3);
        pass.end();

        let commands = encoder.finish({ label: "commandBuffer" });

        device.queue.submit([commands]);
        window.requestAnimationFrame(update);
    };

    window.requestAnimationFrame(update);
});
