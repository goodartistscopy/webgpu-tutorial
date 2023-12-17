import { prefixSum, prefixSumInPlace, roundToDigits, createWorkers, prefixSumParallel } from "./common.js";
import { initContext, loadTextFiles } from "../init/context.js"

async function benchmark(workload, numIters, numWarmups = 0) {
    for (let i = 0; i < numWarmups; i++) {
        await workload();
    }
    for (let i = 0; i < numIters; i++) {
        performance.mark("bench-start");
        await workload();
        performance.measure("bench-dur", "bench-start");
    }
    let mean = 0, stddev = 0;
    performance.getEntriesByType("measure").forEach((entry) => {
        mean += entry.duration;
        stddev += entry.duration * entry.duration;
    });
    mean /= numIters;
    stddev = Math.sqrt((stddev / numIters) - mean * mean);

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

const numElements = 24234; // maximum is 65792 for now;
let arrayIn = buildRandomArray(numElements);
let arrayOut = prefixSum(arrayIn);

let numRuns = 100;
let numWarmups = 20;
let bench = await benchmark(() => prefixSumInPlace(arrayIn, arrayOut), numRuns, numWarmups);
let throughput = arrayIn.length / (1e6 * bench.mean * 1e-3);
console.log(`Sequential: ${roundToDigits(bench.mean, 3)}ms (+/- ${roundToDigits(bench.stddev, 2)}) ${roundToDigits(throughput, 1)} Melem.s^-1`);

// console.log(`in : ${arrayIn}`);
// console.log(`out: ${arrayOut}`);

const maxNumThreads = 16;

// let bufferIn = new SharedArrayBuffer(4 * numElements);
// arrayIn = new Int32Array(bufferIn, 0, numElements);
// fillArrayWithRandom(arrayIn);

//console.log(`in : ${arrayIn}`);

// let bufferOut = new SharedArrayBuffer(4 * numElements);
// arrayOut = new Int32Array(bufferOut);

let workers = createWorkers("./worker.js", maxNumThreads);

// bench = await benchmark(async () => { await prefixSumParallel(arrayIn, arrayOut, workers); }, numRuns, numWarmups);
// throughput = arrayIn.length / (1e6 * bench.mean * 1e-3);
// console.log(`Parallel: ${roundToDigits(bench.mean, 3)}ms (+/- ${roundToDigits(bench.stddev, 2)}) ${roundToDigits(throughput, 1)} Melem.s^-1`);

//console.log(`out: ${arrayOut}`);

// GPU code is designed around blocks of 256 elements
const numSlices = Math.ceil(numElements / 256);
const numElementsPadded = numSlices * 256;

const shaderFiles = ["prefix_sum.wgsl"];

const wgpu = await initContext(null); //, ["timestamp-query"]);
let {device, canvas, context, adapter, ...rest} = wgpu;

let shaders = await loadTextFiles(shaderFiles);

let module = device.createShaderModule({ code: shaders["prefix_sum.wgsl"]});

let srcBuffer = device.createBuffer({ size: 4 * numElementsPadded, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
device.queue.writeBuffer(srcBuffer, 0, arrayIn);
let dstBuffer = device.createBuffer({ size: 4 * numElementsPadded, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE });
// buffers for storing the partial sums of the slices and the prefix sum of them
let partialBuffer = device.createBuffer({ size: 4 * numSlices, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
let partialSumBuffer = device.createBuffer({ size: 4 * numSlices, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE });
let rbBuffer = device.createBuffer({ size: 4 * numElementsPadded, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

let pipeline = device.createComputePipeline({
    compute: {
        module,
        entryPoint: "prefix_sum_hillis_steele",
    },
    layout: "auto"
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
    },
    layout: "auto"
});
let strideBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM });
device.queue.writeBuffer(strideBuffer, 0, Uint32Array.from([256]));
let copyBindGroup = device.createBindGroup({
    entries: [
        { binding: 0, resource: { buffer: dstBuffer } },
        { binding: 1, resource: { buffer: partialBuffer } },
        { binding: 2, resource: { buffer: strideBuffer } },
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
    },
    layout: "auto"
});
let offsetBindGroup = device.createBindGroup({
    entries: [
        { binding: 1, resource: { buffer: dstBuffer } },
        { binding: 2, resource: { buffer: partialSumBuffer } },
    ],
    layout: offsetPipeline.getBindGroupLayout(0),
});

let encoder = device.createCommandEncoder();

//== prefix sum of slices
let pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.dispatchWorkgroups(numElementsPadded / 256);
pass.end();

if (numSlices > 1) {
    // // Get the sum of each slice
    pass = encoder.beginComputePass();
    pass.setPipeline(copyPipeline);
    pass.setBindGroup(0, copyBindGroup);
    pass.dispatchWorkgroups(Math.ceil(numSlices / 256));
    pass.end();

    // Prefix sum of the partial sums
    pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, partialBindGroup);
    pass.dispatchWorkgroups(Math.ceil(numSlices / 256));
    pass.end();

    // Offset the slices by the partial sums
    pass = encoder.beginComputePass();
    pass.setPipeline(offsetPipeline);
    pass.setBindGroup(0, offsetBindGroup);
    pass.dispatchWorkgroups(numElementsPadded / 256);
    pass.end();
}
//encoder.copyBufferToBuffer(dstBuffer, 0, rbBuffer, 0, 4 * numSlices);
encoder.copyBufferToBuffer(dstBuffer, 0, rbBuffer, 0, 4 * numElements);

device.queue.submit([encoder.finish()]);

await rbBuffer.mapAsync(GPUMapMode.READ);
let gpuArrayOut = new Int32Array(rbBuffer.getMappedRange(0, 4 * numElements)).slice();
rbBuffer.unmap();
// console.log(arrayOut.length);
// console.log(gpuArrayOut.length);
// console.log(`arrayOut: ${gpuArrayOut}`);
console.log(`zero? = ${Array.from(gpuArrayOut).map((element, index) => ([element, arrayOut[index]])).map(([x1, x2]) => x1 - x2).reduce((acc,val) => acc + val, 0)}`);

