import { vec3, mat3, mat4 } from "../ext/gl-matrix/dist/esm/index.js";
import { getRenderContext, loadFiles, radians } from "./utils.js";
import { Navigation } from "./navigation.js";
import { PointPrimitiveTechnique } from "./point-primitive-technique.js";
import { QuadsCPUBuiltTechnique } from "./quads-cpu-built-technique.js";
import { QuadsGPUBuiltTechnique } from "./quads-gpu-built-technique.js";
import { InstancingTechnique } from "./instancing-technique.js";
import { StorageBufferTechnique} from "./storage-buffer-technique.js";

const shaderFiles = ["surfels.wgsl", "dilate.wgsl"];

let shaderSources = loadFiles(shaderFiles);

let meshFileContent = fetch("../data/bunny.txt").then(response => response.arrayBuffer()).then(buffer => new Uint8Array(buffer));

function createPointCloud(numPoints) {
    let vbuffer = new Float32Array(numPoints * 7);
    for (let i = 0; i < numPoints; i++) {
        // position in [-1.0, 1.0[
        vbuffer[7 * i + 0] = 2.0 * Math.random() - 1.0;
        vbuffer[7 * i + 1] = 2.0 * Math.random() - 1.0;
        vbuffer[7 * i + 2] = 2.0 * Math.random() - 1.0;
        // normal vector
        let theta = Math.random() * 2.0 * Math.PI;
        let phi = Math.acos(2.0 * Math.random() - 1.0);
        vbuffer[7 * i + 3] = Math.cos(phi);
        vbuffer[7 * i + 4] = Math.sin(phi) * Math.cos(theta);
        vbuffer[7 * i + 5] = Math.sin(phi) * Math.sin(theta);
        // size
        vbuffer[7 * i + 6] = 0.05 + 0.09 * Math.random();
    }
    return vbuffer;
}

function loadMesh(fileContent, normalize = false, scale = 1.0) {
    let decoder = new TextDecoder();
    let getNext = (data, sep) => {
        let next = data.indexOf(sep.charCodeAt(0));
        let str;
        if (next != -1) {
            str = decoder.decode(data.subarray(0, next+1));
        } else {
            str = decoder.decode(data.subarray(0));
        }
        data = data.subarray(next+1);
        return { val: parseFloat(str), rest: data };
    };

    let numVertices, numFaces, data;
    ({val: numVertices, rest: data} = getNext(fileContent, " "));
    ({val: numFaces, rest: data} = getNext(data, "\n"));

    let center = [0.0, 0.0, 0.0];
    let aabbMin = [Infinity, Infinity, Infinity];
    let aabbMax = [-Infinity, -Infinity, -Infinity];

    let val;
    let vertices = new Float32Array(7 * numVertices);
    for (let i = 0; i < numVertices; i++) {
        for (let j = 0; j < 7; j++) {
            ({val, rest: data} = getNext(data, j == 6 ? "\n" : " "));
            vertices[7 * i + j] = val;
        }

        if (normalize) {
            for (let j = 0; j < 3; j++) {
                center[j] += vertices[7 * i + j];
                aabbMin[j] = Math.min(aabbMin[j], vertices[7 * i + j]);
                aabbMax[j] = Math.max(aabbMax[j], vertices[7 * i + j]);
            }
        }
    }

    if (normalize) {
        for (let j = 0; j < 3; j++) {
            center[j] /= numVertices;
        }
        let s = scale / Math.max(aabbMax[0] - aabbMin[0], aabbMax[1] - aabbMin[1], aabbMax[2] - aabbMin[2]);

        for (let i = 0; i < numVertices; i++) {
            for (let j = 0; j < 3; j++) {
                vertices[7 * i + j] = s * (vertices[7 * i + j] - center[j]);
            }
            vertices[7 * i + 6] = s * vertices[7 * i + 6];
        }
    }
    
    let indices = new Uint32Array(3 * numFaces);
    for (let i = 0; i < numFaces; i++) {
        for (let j = 0; j < 3; j++) {
            ({val, rest: data} = getNext(data, j == 2 ? "\n" : " "));
            indices[3 * i + j] = val;
        }
    }

    return {vertices, indices};
}

let initComplete = [getRenderContext("webgpu-canvas")].concat([meshFileContent]).concat(shaderSources);
Promise.all(initComplete).then((results) => {
    let ctx = results[0];
    let device = ctx.device;

    let meshContent = results[1];

    // turn the loaded shader text into a dict, keyed by the filename
    let shaders = results.slice(2).reduce((dict, { file, content }) => {
        dict[file] = content;
        return dict;
    }, {});

    let renderMethod = "points";

    //let pointCloud = createPointCloud(1000);
    let {vertices: pointCloud, indices} = loadMesh(meshContent, true, 3.0);

    // SceneData layout (offset, size)
    //  | scene: (0, 224)
    //  | camera: (0, 192) see Navigation class
    //  | light: (192, 32)
    //  |   light.position: (192, 12)   // 4-bytes padding
    //  |   light.color: (208, 12)      // 4-bytes padding
    let sceneDataBuffer = device.createBuffer({
        label: "SceneData",
        size: 224,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    let lightData = new ArrayBuffer(32);
    let lightPos = new Float32Array(lightData, 0, 3);
    let lightColor = new Float32Array(lightData, 16, 3);
    lightPos.set([1.0, 3.0, 1.0]);
    lightColor.set([1.0, 1.0, 1.0]);

    let navigation = new Navigation(ctx);
    navigation.pov = { theta: 0.0, phi: radians(60), dist: 10.0 };
    navigation.fov = 30.0;
    navigation.registerEvents();

    navigation.setBuffer(sceneDataBuffer, 0);
    device.queue.writeBuffer(sceneDataBuffer, 192, lightData);

    // MeshData layout
    // | mesh: (0, 160)
    // |   model: (0, 64)
    // |   inv_model: (64, 64)
    // |   color: (128, 16)
    // |   point_size_factor: (144, 4)  <- padding + 12
    let meshData = new ArrayBuffer(160);
    let modelMat = new Float32Array(meshData, 0, 16);
    let invModelMat = new Float32Array(meshData, 64, 16);
    let meshColor = new Float32Array(meshData, 128, 4);
    let pointSizeFactor = new Float32Array(meshData, 144, 1);

    mat4.identity(modelMat);
    mat4.invert(invModelMat, modelMat);
    meshColor.set([0.8, 0.8, 1.0, 1.0]);
    pointSizeFactor[0] = 3.0;

    let meshDataBuffer = device.createBuffer({
        label: "MeshData",
        size:  meshData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(meshDataBuffer, 0, meshData);

    let layout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" }}]
    });
    let sceneGroup = device.createBindGroup({ entries: [ { binding: 0, resource: { buffer: sceneDataBuffer }, }, ], layout });
    let meshGroup = device.createBindGroup({ entries: [ { binding: 0, resource: { buffer: meshDataBuffer }, }, ], layout });

    let bindGroupLayouts = [layout, layout];
    let technique = new PointPrimitiveTechnique(ctx, shaders, bindGroupLayouts, [sceneGroup, meshGroup]);
    technique.pointCloud = pointCloud;
    
    let techniques = [];
    techniques["points"] = technique;

    technique = new QuadsCPUBuiltTechnique(ctx, shaders, bindGroupLayouts, [sceneGroup, meshGroup]);
    technique.pointCloud = pointCloud;
    techniques["quads_cpu"] = technique;

    technique = new QuadsGPUBuiltTechnique(ctx, shaders, bindGroupLayouts, [sceneGroup, meshGroup]);
    technique.pointCloud = pointCloud;
    techniques["quads_gpu"] = technique;

    technique = new InstancingTechnique(ctx, shaders, bindGroupLayouts, [sceneGroup, meshGroup]);
    technique.pointCloud = pointCloud;
    technique.depthFuzziness = 5e-2;
    techniques["instancing"] = technique;

    technique = new StorageBufferTechnique(ctx, shaders, bindGroupLayouts, [sceneGroup, meshGroup]);
    technique.pointCloud = pointCloud;
    techniques["storage_buffer"] = technique;

    let update = () => {
        const encoder = device.createCommandEncoder({ label: "myEncoder" });

        techniques[renderMethod].run(encoder);
        
        let commands = encoder.finish({ label: "commandBuffer" });
        device.queue.submit([commands]);
 
        window.requestAnimationFrame(update);
    };

    window.requestAnimationFrame(update);

    document.getElementById("point-size-factor-log").addEventListener("input", (event) => {
        pointSizeFactor[0] = Math.pow(5.0, event.target.value);
        device.queue.writeBuffer(meshDataBuffer, 0, meshData);
        
        if (renderMethod == "points" || renderMethod == "quads_cpu") {
            techniques[renderMethod].pointSizeFactor = (renderMethod == "points") ? 
                Math.max(1.0, Math.ceil(5 * pointSizeFactor[0])) : pointSizeFactor[0];
        }
    });
    
    document.getElementById("method").addEventListener("input", (event) => {
        renderMethod = event.target.value;

        if (renderMethod == "points" || renderMethod == "quads_cpu") {
            techniques[renderMethod].pointSizeFactor = (renderMethod == "points") ? 
                Math.max(1.0, Math.ceil(5 * pointSizeFactor[0])) : pointSizeFactor[0];
        }
    });

    document.getElementById("blend-splats-check").addEventListener("input", (event) => {
        techniques["instancing"].blendSplats = event.target.checked;
    });
});
