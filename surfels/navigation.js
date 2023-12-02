import { vec3, mat4 } from "../ext/gl-matrix/dist/esm/index.js";
import { radians, clamp } from "./utils.js";

export class Navigation {
    static ROT_PHI_PER_PIXELS = radians(0.25);
    static ROT_THETA_PER_PIXELS = radians(0.25);

    constructor(renderContext) {
        this.ctx = renderContext;

        // Camera data layout (offset, size)
        // camera.view: (0, 64)
        // camera.inv_view: (64, 64)
        // camera.proj: (128, 64)
        this.data = new ArrayBuffer(192);
        this.viewMat = new Float32Array(this.data, 0, 16);
        this.invViewMat = new Float32Array(this.data, 64, 16);
        this.projMat = new Float32Array(this.data, 128, 16);
    
        this.theta = 0.0;
        this.phi = 0.0;
        this.dist = 5.0;
    
        this.#updateMatrices();

        this.fov = 30.0;
    }

    setBuffer(buffer, offset) {
        this.buffer = buffer;
        this.offset = offset;

        this.ctx.device.queue.writeBuffer(this.buffer, this.offset, this.data);
    }

    set fov(val) {
        let aspect = this.ctx.canvas.width / this.ctx.canvas.height;
        mat4.perspective(this.projMat, (Math.PI / 180.0) * val, aspect, 0.1, 1000.0); 
    
        if (this.buffer) {
            this.ctx.device.queue.writeBuffer(this.buffer, this.offset + 128, this.projMat);
        }
    }

    set pov({theta, phi, dist}) {
        this.theta = theta;
        this.phi = phi;
        this.dist = dist;
        this.#updateMatrices();
    }

    registerEvents() {
        let canvas = this.ctx.canvas;

        canvas.addEventListener("mousedown", (event) => {
            if (event.button == 0) {
                this.active = true;
                this.mouseInit = { x: event.pageX, y: event.pageY };
                this.anglesInit = { theta: this.theta, phi: this.phi };
            }
        });

        window.addEventListener("mouseup", (event) => {
            if (event.button == 0) {
                this.active = false;
            }
        });

        window.addEventListener("mousemove", (event) => {
            if (this.active) {
                let dx = event.pageX - this.mouseInit.x;
                let dy = event.pageY - this.mouseInit.y;

                this.theta = this.anglesInit.theta + (dx * Navigation.ROT_THETA_PER_PIXELS);
                this.theta = this.theta % (2.0 * Math.PI);
                if (this.theta < 0.0) {
                    this.theta = (2.0 * Math.PI) + this.theta;
                }
                this.phi = clamp(this.anglesInit.phi - (dy * Navigation.ROT_PHI_PER_PIXELS), 1e-6, Math.PI - 1e-6);

                this.#updateMatrices();
            }
        });

        canvas.addEventListener("wheel", (event) => {
            event.preventDefault();

            this.dist += 0.01 * event.deltaY;
            this.dist = Math.max(0.5, this.dist);
            this.#updateMatrices();
        });
    }

    #updateMatrices() {
        let eye = [
            Math.sin(this.phi) * Math.cos(this.theta),
            Math.cos(this.phi),
            Math.sin(this.phi) * Math.sin(this.theta)
        ];
        vec3.scale(eye, eye, this.dist);
        let up = [0.0, 1.0, 0.0];
        mat4.lookAt(this.viewMat, eye, [0.0, 0.0, 0.0], up);
        mat4.invert(this.invViewMat, this.viewMat);

        if (this.buffer) {
            this.ctx.device.queue.writeBuffer(this.buffer, this.offset, new DataView(this.data, 0, 128));
        }
    }
}


