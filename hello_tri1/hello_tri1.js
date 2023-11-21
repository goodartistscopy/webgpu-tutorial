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
        colorSpace: "srgb"
    });

    return {device, context};
}

const shaderFiles = [
    "triangle.wgsl",
];

let shaderSources = shaderFiles.map((file) => {
    return fetch(file).then(response => response.text()).then(text => ({file, text}));
});

let initComplete = [setupCanvas("webgpu-canvas")].concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let {device, context} = results[0];

    // Turn the loaded shader text into a dict, keyed by the filename
    shaders = results.slice(1).reduce((dict, {file, text}) => { dict[file] = text; return dict; }, {});

    //=== Create the shader module
    const shaderModule = device.createShaderModule({code: shaders["triangle.wgsl"]});
    // shaderModule.getCompilationInfo().then(info => {
    //     for (const msg of info.messages) {
    //         console.log(msg.message);
    //     }
    // });
 
    //=== Create a Bind Group Layout for the 'color' uniform
    let bindGroupLayout = device.createBindGroupLayout({
        entries: [{
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform", // default
                }
            }
        ]
    });


    //=== Describe the Layout of our Pipeline
     
    let pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
        label: "BasicPipeline",
        // note: optional
        fragment: {
            //constants: { scale: 1.0 },
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [
                {
                    format: "bgra8unorm",
                    writeMask:  GPUColorWrite.ALL
                }
            ],
            primitive: {
                cullMode: "back",
                frontFace: "ccw",
                topology: "triangle-list",
            }
        },
        vertex: {
            // override constants are Chrome only for now
            //constants: { scale: 1.0 },
            module: shaderModule,
            entryPoint: "vertexMain",
        },
        layout: pipelineLayout
    });

    //=== Create a Buffer to hold our color data
    let colorData = new Float32Array([0.3, 1.0, 0.0, 1.0]);
    let colorBuffer = device.createBuffer({label: "colorBuffer", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // Note: chrome and FF dont' agree on the size parameter (bytes vs number of elements)
    //       Fortunately we can omit it here (whole array uploaded)
    //device.queue.writeBuffer(colorBuffer, 0, colorData, 0, 4); 
    device.queue.writeBuffer(colorBuffer, 0, colorData);

    //=== Create a Bind Group (compatible with the Layout created earlier) to reference our buffer
    let bindGroup = device.createBindGroup({
        entries: [{
                binding: 0,
                resource: { buffer: colorBuffer }
            }
        ],
        layout: bindGroupLayout
    });

    //=== Now we submit oour drawing command
    //  Encoder -> RenderPass -> Draw commands -> Command Buffer -> Queue submission
    const encoder = device.createCommandEncoder({label: "myEncoder"});
    const pass = encoder.beginRenderPass({
        label: "mainPass",
        colorAttachments: [
            {
                clearValue: [ 0.1, 0.3, 0.7, 1.0 ],
                loadOp: "clear",
                storeOp: "store",
                view: context.getCurrentTexture().createView()
            }
        ],
        depthStencilAttachment: undefined,
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
 
    pass.end();

    let commands = encoder.finish({label: "commandBuffer"});

    device.queue.submit([commands]);
});






