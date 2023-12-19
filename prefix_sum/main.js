import { prefixSum, prefixSumInPlace, roundToDigits, createWorkers, prefixSumParallel } from "./common.js";
import { initContext, loadTextFiles } from "../init/context.js";

async function benchmark(workload, numIters, numWarmups = 0) {
    for (let i = 0; i < numWarmups; i++) {
        await workload();
    }
    for (let i = 0; i < numIters; i++) {
        performance.mark("bench-start");
        await workload();
        performance.measure("bench-dur", "bench-start");
    }
    let mean = 0,
        stddev = 0;
    performance.getEntriesByType("measure").forEach((entry) => {
        mean += entry.duration;
        stddev += entry.duration * entry.duration;
    });
    mean /= numIters;
    stddev = Math.sqrt(stddev / numIters - mean * mean);

    performance.clearMeasures();
    performance.clearMarks();

    return { mean, stddev };
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min);
}

function buildRandomArray(length) {
    return Uint32Array.from({ length }, (_) => getRandomInt(0, 10));
}

function fillArrayWithRandom(array) {
    for (let i = 0; i < array.length; i++) {
        array[i] = getRandomInt(0, 10);
    }
}

const numElements = 1e6; // maximum is 65792 for now;
let arrayIn = buildRandomArray(numElements);
let arrayOut = prefixSum(arrayIn);

let numRuns = 100;
let numWarmups = 20;
let bench = await benchmark(() => prefixSumInPlace(arrayIn, arrayOut), numRuns, numWarmups);
let throughput = arrayIn.length / (1e6 * bench.mean * 1e-3);
console.log(
    `Sequential: ${roundToDigits(bench.mean, 3)}ms (+/- ${roundToDigits(bench.stddev, 2)}) ${roundToDigits(
        throughput,
        1,
    )} Melem.s^-1`,
);

//console.log(`in : ${arrayIn}`);
//console.log(`out: ${arrayOut}`);

const maxNumThreads = 16;

let bufferIn = new SharedArrayBuffer(4 * numElements);
arrayIn = new Int32Array(bufferIn, 0, numElements);
fillArrayWithRandom(arrayIn);

//console.log(`in : ${arrayIn}`);

let bufferOut = new SharedArrayBuffer(4 * numElements);
arrayOut = new Int32Array(bufferOut);

let workers = createWorkers("./worker.js", maxNumThreads);

bench = await benchmark(
    async () => {
        await prefixSumParallel(arrayIn, arrayOut, workers);
    },
    numRuns,
    numWarmups,
);
throughput = arrayIn.length / (1e6 * bench.mean * 1e-3);
console.log(
    `Parallel: ${roundToDigits(bench.mean, 3)}ms (+/- ${roundToDigits(bench.stddev, 2)}) ${roundToDigits(
        throughput,
        1,
    )} Melem.s^-1`,
);

//console.log(`out: ${arrayOut}`);

// GPU code is designed around blocks of sliceLength elements
const sliceLength = 1024;
const numSlices = Math.ceil(numElements / sliceLength);
const numSlicesPadded = numSlices * sliceLength;
const numElementsPadded = numSlices * sliceLength;

const shaderFiles = ["prefix_sum.wgsl"];

let extendedLimits = {
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
};
const wgpu = await initContext(null, ["timestamp-query"], extendedLimits);
let { device, canvas, context, adapter, ...rest } = wgpu;

let shaders = await loadTextFiles(shaderFiles);

let module = device.createShaderModule({ code: shaders["prefix_sum.wgsl"] });

//== Timestamp queries for benchmarking
let tsSet;
let tsBuffers = [];
if (device.features.has("timestamp-query")) {
    tsSet = device.createQuerySet({ count: 2, type: "timestamp" });
    // one buffer where the queries will resolve into, one to read the result back to host
    tsBuffers[0] = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE });
    tsBuffers[1] = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
}

let srcBuffer = device.createBuffer({
    size: 4 * numElementsPadded,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(srcBuffer, 0, arrayIn);
let dstBuffer = device.createBuffer({
    size: 4 * numElementsPadded,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
});
// buffers for storing the partial sums of the slices and the prefix sum of them
let partialBuffer = device.createBuffer({
    size: 4 * numSlices,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
let partialSumBuffer = device.createBuffer({
    size: 4 * numSlices,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
});
let rbBuffer = device.createBuffer({
    size: 4 * numElementsPadded,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

let pipeline = device.createComputePipeline({
    compute: {
        module,
        entryPoint: "prefix_sum_hillis_steele",
        constants: {
            slice_length: sliceLength,
        },
    },
    layout: "auto",
});
let bindGroup = device.createBindGroup({
    entries: [
        { binding: 0, resource: { buffer: srcBuffer } },
        { binding: 1, resource: { buffer: dstBuffer } },
    ],
    layout: pipeline.getBindGroupLayout(0),
});

let copyPipeline = device.createComputePipeline({
    compute: {
        module,
        entryPoint: "strided_copy",
        constants: {
            slice_length: sliceLength,
        },
    },
    layout: "auto",
});
let copyBindGroup = device.createBindGroup({
    entries: [
        { binding: 0, resource: { buffer: dstBuffer } },
        { binding: 1, resource: { buffer: partialBuffer } },
    ],
    layout: copyPipeline.getBindGroupLayout(0),
});
let partialBindGroup = device.createBindGroup({
    entries: [
        { binding: 0, resource: { buffer: partialBuffer } },
        { binding: 1, resource: { buffer: partialSumBuffer } },
    ],
    layout: pipeline.getBindGroupLayout(0),
});

let offsetPipeline = device.createComputePipeline({
    compute: {
        module,
        entryPoint: "offset_slices",
        constants: {
            slice_length: sliceLength,
        },
    },
    layout: "auto",
});
let offsetBindGroup = device.createBindGroup({
    entries: [
        { binding: 1, resource: { buffer: dstBuffer } },
        { binding: 2, resource: { buffer: partialSumBuffer } },
    ],
    layout: offsetPipeline.getBindGroupLayout(0),
});

performance.mark("gpu-start");
let encoder = device.createCommandEncoder();
encoder.writeTimestamp(tsSet, 0);

//== prefix sum of slices
let pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.dispatchWorkgroups(numElementsPadded / sliceLength);
pass.end();

if (numSlices > 1) {
    // // Get the sum of each slice
    pass = encoder.beginComputePass();
    pass.setPipeline(copyPipeline);
    pass.setBindGroup(0, copyBindGroup);
    pass.dispatchWorkgroups(Math.ceil(numSlices / sliceLength));
    pass.end();

    // Prefix sum of the partial sums
    pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, partialBindGroup);
    pass.dispatchWorkgroups(Math.ceil(numSlices / sliceLength));
    pass.end();

    // Offset the slices by the partial sums
    pass = encoder.beginComputePass();
    pass.setPipeline(offsetPipeline);
    pass.setBindGroup(0, offsetBindGroup);
    pass.dispatchWorkgroups(numElementsPadded / sliceLength);
    pass.end();
}
//encoder.copyBufferToBuffer(dstBuffer, 0, rbBuffer, 0, 4 * numSlices);
encoder.copyBufferToBuffer(dstBuffer, 0, rbBuffer, 0, 4 * numElements);

encoder.writeTimestamp(tsSet, 1);
encoder.resolveQuerySet(tsSet, 0, 2, tsBuffers[0], 0);
encoder.copyBufferToBuffer(tsBuffers[0], 0, tsBuffers[1], 0, 16);

device.queue.submit([encoder.finish()]);
performance.mark("gpu-submit");

await rbBuffer.mapAsync(GPUMapMode.READ);
let gpuArrayOut = new Int32Array(rbBuffer.getMappedRange(0, 4 * numElements)).slice();
rbBuffer.unmap();
performance.mark("gpu-end");

performance.measure("gpu-submit", "gpu-start", "gpu-submit");
performance.measure("gpu-readback", "gpu-submit", "gpu-end");
let gpuSubmitDuration = performance.getEntriesByName("gpu-submit", "measure")[0].duration;
let gpuReadBackDuration = performance.getEntriesByName("gpu-readback", "measure")[0].duration;

await tsBuffers[1].mapAsync(GPUMapMode.READ);
let ts = new BigInt64Array(tsBuffers[1].getMappedRange()).slice();
tsBuffers[1].unmap();
let gpuExecDuration = Number(ts[1] - ts[0]) / 1e6;

console.log(
    `GPU compute: submit: ${roundToDigits(gpuSubmitDuration, 3)} ms, readback: ${roundToDigits(
        gpuReadBackDuration,
        3,
    )} ms, execution: ${roundToDigits(gpuExecDuration, 3)} ms`,
);

//console.log(`arrayOut: ${gpuArrayOut}`);
console.log(
    `diff = ${Array.from(gpuArrayOut)
        .map((element, index) => [element, arrayOut[index]])
        .map(([x1, x2]) => x1 - x2)
        .reduce((acc, val) => acc + val, 0)}`,
);
