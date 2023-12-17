import { prefixSumInPlace } from "./common.js";

/// Notes on locking: implementing a mutex
// lock
// while (Atomics.compareExchange(mutex, 0, 0, 1) != 0) {
//     Atomics.wait(mutex, 0, 0);
// }
//
// unlock
// Atomics.store(mutex, 0, 0);
// Atomics.notify(mutex, 0);

addEventListener("message", (event) => {
    switch (event.data[0]) {
        case 0: {
            let array = new Int32Array(event.data[1], event.data[2], event.data[3]);

            let bufferOut = event.data[4];
            let dest = new Int32Array(bufferOut, event.data[2], event.data[3]);
            prefixSumInPlace(array, dest);

            let semaphore = new Int32Array(event.data[5]);
            Atomics.add(semaphore, event.data[6], 1);
            Atomics.notify(semaphore, event.data[6]);
            break;
        }
        case 1: {
            let array = new Int32Array(event.data[1], event.data[2], event.data[3]);
            let offset = event.data[4];

            for (let i = 0; i < array.length; i++) {
                array[i] += offset;
            }

            let semaphore = new Int32Array(event.data[5]);
            Atomics.add(semaphore, event.data[6], 1);
            Atomics.notify(semaphore, event.data[6]);

            break;
        }
    }
});
