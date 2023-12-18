import { initContext, loadTextFiles } from "../init/context.js";

const shaderFiles = ["transpose.wgsl", "transpose_tiled.wgsl"];
const numRuns = 100;
let wg_size = [16, 16];

const sourceImage = document.getElementById("image");
const resultCanvas = document.getElementById("result");

const wgpu = await initContext(null, ["timestamp-query"]);
let { device, canvas, context, ...rest } = wgpu;

let shaders = await loadTextFiles(shaderFiles);

//== Create the source data bitmap->texture/buffer (depends on pipeline)
let srcBitmap = await createImageBitmap(sourceImage);
let srcTexture = device.createTexture({
    size: [srcBitmap.width, srcBitmap.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
device.queue.copyExternalImageToTexture({ source: srcBitmap }, { texture: srcTexture }, [srcBitmap.width, srcBitmap.height]);

let srcBuffer = device.createBuffer({
    size: srcBitmap.width * srcBitmap.height * 4,
    usage: /*GPUBufferUsage.COPY_SRC debug | */ GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});

let enc = device.createCommandEncoder();
enc.copyTextureToBuffer({ texture: srcTexture }, { buffer: srcBuffer, bytesPerRow: 4 * srcBitmap.width }, [srcBitmap.width, srcBitmap.height]);
device.queue.submit([enc.finish()]);

//== Create the destination data texture/buffer (depends on pipeline)
let dstTexture = device.createTexture({
    size: [srcBitmap.height, srcBitmap.width],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

let dstBuffer = device.createBuffer({
    size: srcBitmap.width * srcBitmap.height * 4,
    //usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
});

//== Timestamp queries for benchmarking
let tsSet;
let tsBuffers = [];
if (device.features.has("timestamp-query")) {
    tsSet = device.createQuerySet({ count: 2, type: "timestamp" });
    // one buffer where the queries will resolve into, one to read the result back to host
    tsBuffers[0] = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE });
    tsBuffers[1] = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
}

//=== Create the shader module
const module = device.createShaderModule({
    code: shaders["transpose.wgsl"],
});

const module_tiled = device.createShaderModule({
    code: shaders["transpose_tiled.wgsl"],
});

//== Pipelines and bind groups created 
let naiveTexPipeline, tiledTexPipeline, tiledBufPipeline;
let buffersBindGroup, texturesBindGroup;

document.getElementById("reset-button").addEventListener("click", () => {
    sourceImage.style = "display: block";
    resultCanvas.style = "display: none";
    document.getElementById("bench-result").value = "";
});

document.getElementById("group_width").addEventListener("change", () => {
    wg_size[0] = Number(event.target.value);
});

document.getElementById("group_height").addEventListener("change", () => {
    wg_size[1] = Number(event.target.value);
});

document.getElementById("benchmark-button").addEventListener("click", async () => {
    buildPipelines();
    let res;
    switch (document.getElementById("method").value) {
        case "naive-tex":
            if (tsSet) {
                res = await benchmark(naiveTexPipeline, texturesBindGroup, wg_size);
            } else {
                run(naiveTexPipeline, texturesBindGroup, wg_size);
            }
            await displayResult(dstTexture);
            break;
        case "tiled-tex":
            let size = Math.min(wg_size[0]);
            if (tsSet) {
                res = await benchmark(tiledTexPipeline, texturesBindGroup, [size, size]);
            } else {
                run(tiledTexPipeline, texturesBindGroup, [size, size]);
            }
            await displayResult(dstTexture);
            break;
        case "tiled-buf":
            if (tsSet) {
                res = await benchmark(tiledBufPipeline, buffersBindGroup, [wg_size[0], wg_size[0]]);
            } else {
                run(tiledBufPipeline, buffersBindGroup, [wg_size[0], wg_size[0]]);
            }
            await displayResult(dstBuffer);
            break;
    }

    let resultEntry = document.getElementById("bench-result");
    if (tsSet) {
        console.log(`duration: ${res} us`);
        resultEntry.value = `${res} us`;
    } else {
        resultEntry.value = `Timestamp queries unavailable`;
    }
});


function buildPipelines() {
    // Access through textures
    const texturesGroupLayout = device.createBindGroupLayout({
        entries : [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: "rgba8unorm", access: "write-only" } },
        ]
    });
    const texturesPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [texturesGroupLayout],
    });

    // Access through buffers
    const buffersGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {} }, // optional uniform buffer
        ],
    });
    let buffersPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [buffersGroupLayout],
    });

    //== Naive technique, access VRAM direxctly through textures
    naiveTexPipeline = device.createComputePipeline({
        compute: {
            module,
            entryPoint: "transpose",
            constants: { 0: wg_size[0], 1: wg_size[1] },
        },
        layout: texturesPipelineLayout,
    });

    //== Use shared memory, access through textures
    tiledTexPipeline = device.createComputePipeline({
        compute: {
            module: module_tiled,
            entryPoint: "transpose_tiled",
            constants: { 0: Math.min(wg_size[0], 16) },
        },
        layout: texturesPipelineLayout,
    });

    // Same as tiledTexPipeline, but use storage buffers and mitigate bank conflicts
    tiledBufPipeline = device.createComputePipeline({
        compute: {
            module,
            entryPoint: "transpose_tiled_buffers",
            constants: { 2: wg_size[0], 3: wg_size[1] },
        },
        layout: buffersPipelineLayout,
    });

    texturesBindGroup = device.createBindGroup({
        entries: [
            { binding: 0, resource: srcTexture.createView() },
            { binding: 1, resource: dstTexture.createView() },
        ],
        layout: texturesGroupLayout,
    });

    let sizeBuffer = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM });
    device.queue.writeBuffer(sizeBuffer, 0, Uint32Array.from([srcBitmap.width, srcBitmap.height]));

    buffersBindGroup = device.createBindGroup({
        entries: [
            { binding: 0, resource: { buffer: srcBuffer } },
            { binding: 1, resource: { buffer: dstBuffer } },
            { binding: 2, resource: { buffer: sizeBuffer } },
        ],
        layout: buffersGroupLayout,
    });
}

// run the pipeline once
function transpose(pipeline, bindGroup, size) {
    const encoder = device.createCommandEncoder();
    
    let pass = encoder.beginComputePass({ });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(srcBitmap.width / size[0], srcBitmap.height / size[1]);
    pass.end();

    let commands = encoder.finish();
    device.queue.submit([commands]);
}

async function benchmark(pipeline, bindGroup, size) {
    if (!tsSet) {
        return null;
    }

    const encoder = device.createCommandEncoder();
    let timestampWrites = {
        querySet: tsSet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
    };

    let pass = encoder.beginComputePass({ timestampWrites });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    for (let i = 0; i < numRuns; i++) {
        pass.dispatchWorkgroups(srcBitmap.width / size[0], srcBitmap.height / size[1]);
    }
    pass.end();

    encoder.resolveQuerySet(tsSet, 0, 2, tsBuffers[0], 0);
    encoder.copyBufferToBuffer(tsBuffers[0], 0, tsBuffers[1], 0, 16);

    let commands = encoder.finish();
    device.queue.submit([commands]);

    await tsBuffers[1].mapAsync(GPUMapMode.READ);
    let ts = new BigUint64Array(tsBuffers[1].getMappedRange()).slice();
    tsBuffers[1].unmap();
    return Number((ts[1] - ts[0])) / (1e3 * numRuns);
}

// Read back result and draw it on the canvas
async function displayResult(resObject) {
    let rbBuffer = device.createBuffer({
        size: srcBitmap.width * srcBitmap.height * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const encoder = device.createCommandEncoder();
    
    if (resObject.constructor.name === "GPUTexture") {
        encoder.copyTextureToBuffer(
            { texture: resObject },
            { buffer: rbBuffer, bytesPerRow: srcBitmap.height * 4 },
            [srcBitmap.height, srcBitmap.width]);
    } else {
        encoder.copyBufferToBuffer(resObject, 0, rbBuffer, 0, dstBuffer.size);
    }

    device.queue.submit([encoder.finish()]);

    await rbBuffer.mapAsync(GPUMapMode.READ);
    let dstData = new ImageData(new Uint8ClampedArray(rbBuffer.getMappedRange()), srcBitmap.height, srcBitmap.width);
    let transposedBitmap = await createImageBitmap(dstData);

    const ctx = resultCanvas.getContext("2d");
    resultCanvas.width = srcBitmap.height;
    resultCanvas.height = srcBitmap.width;
    ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    ctx.drawImage(transposedBitmap, 0, 0);
    resultCanvas.style = "display: block;";
    sourceImage.style = "display: none;";

    rbBuffer.unmap();
    rbBuffer.destroy();
}
