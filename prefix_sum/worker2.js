import { prefixSumInPlace } from "./common.js";

addEventListener("message", (event) => {
    console.log("there!");
    let slice = { buffer: event.data[0], offset: event.data[1], length: event.data[2] };
    let array = new Int32Array(slice.buffer, slice.offset, slice.length);

    let offset = event.data[3];
    for (let i = 0; i < slice.length; i++) {
        array[i] += offset;
    }

    let semaphore = new Int32Array(event.data[4]);
    Atomics.add(semaphore, event.data[5], 1);
    Atomics.notify(semaphore, event.data[5]);
});

