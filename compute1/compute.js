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
            setupCanvas();
        }
    });

    let context, canvas;
    if (canvasId) {
        // Get a context to display our rendered image on the canvas
        canvas = document.getElementById(canvasId);
        context = canvas.getContext("webgpu");

        let format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device: device,
            format: format,
            alphaMode: "opaque",
            colorSpace: "srgb",
        });
    }

    return { device, context, canvas };
}

const shaderFiles = ["compute.wgsl"];

let shaderSources = shaderFiles.map((file) => {
    return fetch(file, { cache: "no-cache" })
        .then((response) => response.text())
        .then((text) => ({ file, text }));
});

let initComplete = [setupCanvas("webgpu-canvas")].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context, canvas } = results[0];

    // Turn the loaded shader text into a dict, keyed by the filename
    shaders = results.slice(1).reduce((dict, { file, text }) => {
        dict[file] = text;
        return dict;
    }, {});

    //=== Create the shader module
    const module = device.createShaderModule({
        code: shaders["compute.wgsl"],
    });

    //=== Create a compute pipeline
    let computeBindGroupLayout = device.createBindGroupLayout({
        entries : [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"} },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: {format: "rgba8unorm" } },
        ]
    });

    let layout = device.createPipelineLayout({
        bindGroupLayouts: [ computeBindGroupLayout ]
    });
    const computePipeline = device.createComputePipeline({
        compute: {
            module,
            entryPoint: "csMain"
        },
        layout,
    });

    //=== Render pass displays the texture
    let renderBindGroupLayout = device.createBindGroupLayout({
        entries : [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { } },
        ]
    });

    layout = device.createPipelineLayout({
        bindGroupLayouts: [ renderBindGroupLayout ]
    });
    const renderPipeline = device.createRenderPipeline({
        vertex: { module, entryPoint: "vsMain" },
        fragment: {
            module,
            entryPoint: "fsMain",
            targets: [
                {
                    format: navigator.gpu.getPreferredCanvasFormat()
                }
            ],
        },
        layout,
    });

    //=== Compute pass resources
    let counter = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
    })
    device.queue.writeBuffer(counter, 0, Uint32Array.from(0));
    
    let texture = device.createTexture({
        format: "rgba8unorm",
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    let computeBindGroup = device.createBindGroup({
        entries: [
            { binding: 0, resource: { buffer: counter } },
            { binding: 1, resource: texture.createView() },
        ],
        layout: computeBindGroupLayout,
    })

    //=== Render pass resources
    let renderBindGroup = device.createBindGroup({
        entries: [
            { binding: 0, resource: texture.createView() },
        ],
        layout: renderBindGroupLayout,
    })

    //=== Run the compute pass
    const encoder = device.createCommandEncoder();
    let pass = encoder.beginComputePass();
    pass.setBindGroup(0, computeBindGroup);
    pass.setPipeline(computePipeline);

    pass.dispatchWorkgroups(canvas.width / 8, canvas.height / 8);
    pass.end();

    //=== Run the render pass
    pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                clearValue: [0.1, 0.3, 0.7, 1.0],
                loadOp: "clear",
                storeOp: "store",
                view: context.getCurrentTexture().createView(),
            },
        ],
    });

    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroup);
    pass.draw(3);
    pass.end();

    let commands = encoder.finish();
    device.queue.submit([commands]);
});
