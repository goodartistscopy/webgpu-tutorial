export function inclusiveScan(arrayIn, op) {
    let acc = 0;
    return arrayIn.map((val) => { acc = op(acc, val); return acc; });
}

export function prefixSum(arrayIn) {
    let acc = 0;
    return arrayIn.map((val) => { acc = acc + val; return acc; });
}

const prefixSumAlt = (array) => inclusiveScan(array, (a, b) => a + b);

export function prefixSumInPlace(arrayIn, arrayOut) {
    let acc = 0;
    for (let i = 0; i < arrayIn.length; i++) {
        acc += arrayIn[i];
        arrayOut[i] = acc;
    }
}

export function roundToDigits(number, digits) {
    let p = Math.pow(10, digits);
    return Math.round(number * p) / p;
}

export function createWorkers(path, num) {
    let workers = [];
    for (let i = 0; i < num; i++) {
        workers.push(new Worker(path, { type: "module" }));
    }
    return workers;
}

export async function prefixSumParallel(arrayIn, arrayOut, workers) {
    let maxNumThreads = workers.length;
    let numElements = arrayIn.length;
    let bufferOut = arrayOut.buffer; 

    // Compute split size
    let subArrayLen = Math.ceil(numElements / maxNumThreads);
    let numThreads = Math.floor((numElements + subArrayLen - 1) / subArrayLen);
    let lastSubArrayLen = numElements % subArrayLen;

    //console.log(`Splitting into ${numThreads} slices (size: ${subArrayLen}, last: ${lastSubArrayLen})`);

    // Launch a worker scanning its own slice
    let semaphoreBuf = new SharedArrayBuffer(4 * numThreads); // this is for "joining" the worker later
    for (let i = 0; i < numThreads; i++) {
        const len = (i == numThreads - 1) && (lastSubArrayLen > 0) ? lastSubArrayLen : subArrayLen;
        const offset = 4 * i * subArrayLen;
        workers[i].postMessage([0, arrayIn.buffer, offset, len, bufferOut, semaphoreBuf, i]);
    }
    
    // wait for all worker to finish
    let semaphore = new Int32Array(semaphoreBuf);
    let j = [];
    for (let n = numThreads-1; n >= 0; n--) {
        let wait = Atomics.waitAsync(semaphore, n, 0);
        j.push(wait.value);
    }
    await Promise.all(j);

    // recombine the sub-scans (add partial sum of previous slice to each slice)
    let subSums = [];
    for (let i = 0; i < numThreads; i++) {
        const len = (i == numThreads - 1) && (lastSubArrayLen > 0) ? lastSubArrayLen : subArrayLen;
        const last = i * subArrayLen + len - 1;
        subSums.push(arrayOut[last]);
    }

    let subSumsPrefix = prefixSum(subSums);
    // console.log(`partials: ${subSums}`);
    // console.log(`partials scan: ${subSumsPrefix}`);

    semaphore.fill(0);
    for (let i = 1; i < numThreads; i++) {
        const len = (i == numThreads - 1) && (lastSubArrayLen > 0) ? lastSubArrayLen : subArrayLen;
        const offset = 4 * i * subArrayLen;
        workers[i].postMessage([1, bufferOut, offset, len , subSumsPrefix[i-1], semaphoreBuf, i]);
    }

    j = [];
    for (let n = numThreads-1; n >= 1; n--) {
        let wait = Atomics.waitAsync(semaphore, n, 0);
        j.push(wait.value);
    }
    await Promise.all(j);
}
