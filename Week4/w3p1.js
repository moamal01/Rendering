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
  const uniformBuffer_f = device.createBuffer({
    size: 16, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // const bindGroup = device.createBindGroup({
  //   layout: pipeline.getBindGroupLayout(0),
  //   entries: [
  //     {
  //       binding: 0,
  //       resource: { buffer: uniformBuffer },
  //     },
  //   ],
  // });

  const aspect = canvas.width / canvas.height;
  var cam_const = 1.0;
  var gamma = 1;
  var shader = 5;
  var uniforms_f = new Float32Array([aspect, cam_const, gamma, shader]);
  device.queue.writeBuffer(uniformBuffer_f, 0, uniforms_f);


  var addressMenu = document.getElementById("addressmode");
  var filterMenu = document.getElementById("filtermode");
  const use_repeat = addressMenu.selectedIndex;
  const use_linear = filterMenu.selectedIndex;
  var uniforms_ui = new Uint32Array([use_repeat, use_linear]);

  const uniformBuffer_ui = device.createBuffer({
    size: uniforms_ui.byteLength, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);
  addressMenu.addEventListener("click", () => {
    uniforms_ui[0] = addressMenu.selectedIndex;
    device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);
    requestAnimationFrame(animate);
  });
  filterMenu.addEventListener("click", () => {
    uniforms_ui[1] = filterMenu.selectedIndex;
    device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);
    requestAnimationFrame(animate);
  });

  async function load_texture(device, filename)
  {
    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const texture = device.createTexture({
      size: [img.width, img.height, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
      { source: img, flipY: true },
      { texture: texture },
      { width: img.width, height: img.height },
    );
    return texture;
  }

  const texture = await load_texture(device, "grass.jpg");
  const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer_f } },
      { binding: 1, resource: { buffer: uniformBuffer_ui } },
      { binding: 2, resource: texture.createView() },
    ],
  });


  function animate() {
    uniforms_f[1] = cam_const;
    device.queue.writeBuffer(uniformBuffer_f, 0, uniforms_f);
    render();
  }
  animate();

  addEventListener("wheel", (event) => {
    cam_const *= 1.0 + 2.5e-4 * event.deltaY;
    requestAnimationFrame(animate);
  });

  shaderMenu.addEventListener("change", (event) => {
    uniforms_f[3] = shaderMenu.selectedIndex + 1;
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