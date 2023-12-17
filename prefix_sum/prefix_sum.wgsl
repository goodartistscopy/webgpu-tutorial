@group(0) @binding(0) var<storage, read_write> src: array<i32>;
@group(0) @binding(1) var<storage, read_write> dst: array<i32>;

const d: u32 = 256;
// dual partitioned temporary array
var<workgroup> temp: array<i32, 2 * d>;

@compute @workgroup_size(d)
fn prefix_sum_hillis_steele(
    @builtin(local_invocation_id) thread_id: vec3<u32>,
    @builtin(global_invocation_id) global_id: vec3<u32>
    )
{
    // ping-pong between two arrays
    var p_in:u32 = 0;
    var p_out:u32 = d;
    temp[p_in + thread_id.x] = src[global_id.x];
    workgroupBarrier();

    for (var offset = 1u; offset < d; offset *= 2u) {
        
        if (thread_id.x < offset) {
            temp[p_out + thread_id.x] = temp[p_in + thread_id.x];
        } else {
            temp[p_out + thread_id.x] = temp[p_in + thread_id.x] + temp[p_in + thread_id.x - offset];
        }
        
        workgroupBarrier();
        
        // swap temp buffer partitions
        p_in = d - p_in;
        p_out = d - p_out;
    }

    dst[global_id.x] = temp[p_in + thread_id.x];
}

@group(0) @binding(2) var<uniform> stride: u32;

@compute @workgroup_size(256)
fn strided_copy(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (global_id.x < arrayLength(&dst)) {
        let idx = (global_id.x + 1) * stride - 1;
        dst[global_id.x] = src[idx];
    }
}

@group(0) @binding(2) var<storage, read_write> partialSums: array<i32>;

@compute @workgroup_size(256)
fn offset_slices(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) slice_id: vec3<u32>
    )
{
    if slice_id.x > 0 {
        dst[global_id.x] += partialSums[slice_id.x - 1];
    }
}
