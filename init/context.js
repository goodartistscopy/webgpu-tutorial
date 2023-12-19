// Initialize WebGPU, get a device and configure a context for the canvas element
// of given id (if provided)
// Return { adapter, device, context, canvas }
async function initContext(canvasId, features, limits) {
    if (!navigator.gpu) {
        throw Error("WebGPU not supported.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw Error("Couldn't request WebGPU adapter.");
    }

    let requiredFeatures = (features || []).filter((feature) => adapter.features.has(feature));

    let requiredLimits = Object.entries(limits).reduce((acc, [limit, value]) => {
        if ((adapter.limits[limit] || 0) >= value) {
            acc[limit] = value;
        }
        return acc;
    }, {});

    // Create a GPUDevice
    let device = await adapter.requestDevice({ requiredFeatures, requiredLimits });

    // Use lost to handle lost devices
    device.lost.then((info) => {
        console.error(`WebGPU device was lost: ${info.message}`);
        device = null;

        if (info.reason !== "destroyed") {
            initContext(canvaId);
        }
    });

    let context, canvas;
    if (canvasId) {
        // Get a context to display our rendered image on the canvas
        canvas = document.getElementById(canvasId);
        if (canvas) {
            context = canvas.getContext("webgpu");

            let format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device: device,
                format: format,
                alphaMode: "opaque",
                colorSpace: "srgb",
            });
        }
    }

    return { adapter, device, context, canvas };
}

async function loadTextFiles(urls) {
    let texts = await Promise.all(
        urls.map((url) =>
            fetch(url, { cache: "no-cache" })
                .then((response) => response.text())
                .then((text) => ({ url, text })),
        ),
    );

    // Turn the array of (filename, content) into a dict keyed by the filename
    let dict = {};
    texts.forEach(({ url, text }) => {
        dict[url] = text;
    });
    return dict;
}

export { initContext, loadTextFiles };
