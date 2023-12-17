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

    let context;
    if (canvasId) {
        // Get a context to display our rendered image on the canvas
        let canvas = document.getElementById(canvasId);
        context = canvas.getContext("webgpu");

        let format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device: device,
            format: format,
            alphaMode: "opaque",
            colorSpace: "srgb",
        });
    }

    return { device, context };
}

const shaderFiles = ["compute.wgsl"];

let shaderSources = shaderFiles.map((file) => {
    return fetch(file, { cache: "no-cache" })
        .then((response) => response.text())
        .then((text) => ({ file, text }));
});

let initComplete = [setupCanvas()].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let { device, context } = results[0];

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
    const pipeline = device.createComputePipeline({
        compute: {
            module,
            entryPoint: "csMain"
        },
        layout: "auto",
    });

    //=== Create the buffers to hold our data
    let numElements = 128;
    const data = Int32Array.from({ length: numElements }, (_, i) => i);
    let dataIn = device.createBuffer({ size: numElements * 4, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
    device.queue.writeBuffer(dataIn, 0, data);
    // storage buffers cannot be mapped, so we need an additional "staging" buffer
    let dataOut = device.createBuffer({ size: numElements * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    let bindGroup = device.createBindGroup({
        entries: [ {binding: 0, resource: { buffer: dataIn } } ],
        layout: pipeline.getBindGroupLayout(0),
    })

    //=== Run the compute pass
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeline);

    pass.dispatchWorkgroups(8);
    pass.end();

    //=== Copy the storage buffer to the staging buffer
    encoder.copyBufferToBuffer(dataIn, 0, dataOut, 0, numElements * 4);

    let commands = encoder.finish();
    device.queue.submit([commands]);

    //=== Map the staging buffer and retrieve the data
    dataOut.mapAsync(GPUMapMode.READ).then(() => {
        let rbData = new Int32Array(dataOut.getMappedRange());
        console.log(rbData);
        dataOut.unmap();
    });
});
