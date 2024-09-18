"use strict";
window.onload = function () {
  main();
};
async function main() {
  const shaderMenu = document.getElementById("shaderMenu");
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const canvas = document.getElementById("webgpu-canvas");
  const context =
    canvas.getContext("gpupresent") || canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
  });
  // Insert render pass commands here
  const wgsl = device.createShaderModule({
    code: document.getElementById("wgsl").text,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-strip",
    },
  });
  const uniformBuffer = device.createBuffer({
    size: 16, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  const aspect = canvas.width / canvas.height;
  var cam_const = 1.0;
  var gamma = 1;
  var shader = 2;
  var uniforms = new Float32Array([aspect, cam_const, gamma, shader]);
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  function animate() {
    uniforms[1] = cam_const;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    render();
  }
  animate();

  addEventListener("wheel", (event) => {
    cam_const *= 1.0 + 2.5e-4 * event.deltaY;
    requestAnimationFrame(animate);
  });

  shaderMenu.addEventListener("change", (event) => {
    uniforms[3] = shaderMenu.selectedIndex + 1;
    requestAnimationFrame(animate);
  });

  function render() {
    // Create render pass in a command buffer
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}
