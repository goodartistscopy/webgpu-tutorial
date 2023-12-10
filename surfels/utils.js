async function getRenderContext(canvasId = undefined) {
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

    let canvas, context;
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

// Return an array of Promise({file, content})
function loadFiles(urls) {
    return urls.map((url) => {
        return fetch(url, { cache: "no-cache" })
            .then((response) => {
                if (response.status >= 200 && response.status < 400) {
                    return response.text();
                } else {
                    throw undefined;
                }
            })
            .then((content) => {
                let filename = url.split('/').pop();
                return { file: filename, content };
            })
            .catch(() => ({ url, content: `// File ${url} not found` }));
    });
}

function radians(degrees) {
    return degrees * (Math.PI / 180.0);
}

function clamp(v, a, b) {
    return Math.min(Math.max(v, a), b);
}

export { getRenderContext, loadFiles, radians, clamp };
