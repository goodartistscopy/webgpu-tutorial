@id(0) override wg_size_x: u32 = 16;
@id(1) override wg_size_y: u32 = 16;
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dest: texture_storage_2d<rgba8unorm, write>;

//== Basic technique, going through VRAM directly
@compute @workgroup_size(wg_size_x, wg_size_y)
fn transpose(@builtin(global_invocation_id) coords: vec3<u32>) {
    textureStore(dest, coords.yx, textureLoad(src, coords.xy, 0));
}

//== Local memory, mitigate bank conflicts, storage buffers
@group(0) @binding(0) var<storage, read> srcBuffer: array<u32>;
@group(0) @binding(1) var<storage, read_write> destBuffer: array<u32>;
@group(0) @binding(2) var<uniform> srcDim: vec2u;

@id(2) override TILE_SIZE: u32 = 32;
@id(3) override BLOCK_ROWS: u32 = 8;
var<private> TILE_STRIDE: u32 = TILE_SIZE + 1; // removing bank conflicts
var<workgroup> tile: array<u32, (TILE_SIZE + 1) * TILE_SIZE>;

@compute @workgroup_size(TILE_SIZE, BLOCK_ROWS)
fn transpose_tiled_buffers(@builtin(local_invocation_id) thread_id: vec3<u32>,
                     @builtin(workgroup_id) group_id: vec3<u32>) {
    var x = group_id.x * TILE_SIZE + thread_id.x;
    var y = group_id.y * TILE_SIZE + thread_id.y;

    for (var i = 0u; i < TILE_SIZE; i += BLOCK_ROWS) {
        tile[(thread_id.y + i) * TILE_STRIDE + thread_id.x] = srcBuffer[(y + i) * srcDim.x + x];
    }

   workgroupBarrier();

    x = group_id.y * TILE_SIZE + thread_id.x;
    y = group_id.x * TILE_SIZE + thread_id.y;

    for (var i = 0u; i < TILE_SIZE; i += BLOCK_ROWS) {
        //                                           |-- bank conflict can occur here if TILE_STRIDE
        //                                           v   is a multiple of NUM_BANKS
        destBuffer[(y + i) * srcDim.y + x] = tile[thread_id.x * TILE_STRIDE + thread_id.y + i];
    }
}
