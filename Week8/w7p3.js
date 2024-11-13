"use strict";
window.onload = function () {
  main();
};
async function main() {
  const canvas = document.getElementById("webgpu-canvas");
  const shaderMenu = document.getElementById("shaderMenu");
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("gpupresent") || canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  var progLoadToggle = document.getElementById("prog_load");
  var progLoad = true;

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
      targets: [ { format: canvasFormat },
                 { format: "rgba32float" } ],
    },
    primitive: {
      topology: "triangle-strip",
    },
  });

  // Ping Pong rendering
  let textures = new Object();
  textures.width = canvas.width;
  textures.height = canvas.height;
  textures.renderSrc = device.createTexture({
    size: [canvas.width, canvas.height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    format: 'rgba32float',
  });
  textures.renderDst = device.createTexture({
    size: [canvas.width, canvas.height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    format: 'rgba32float',
  });

  // Uniform f buffer
  const uniformBuffer_f = device.createBuffer({
    size: 16, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Uniform ui buffer
  var addressMenu = document.getElementById("addressmode");
  var filterMenu = document.getElementById("filtermode");

  var uniforms_ui = new Uint32Array([canvas.height, canvas.width, 0]);

  const uniformBuffer_ui = device.createBuffer({
    size: uniforms_ui.byteLength, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);

  // Texture
  const texture = await load_texture(device, "../common/grass.jpg");

  // Buffers
  var drawingInfo = await readOBJFile("../objects/CornellBoxWithBlocks.obj", 1.0, true);
  var buffers = new Object();

  // Material buffer
  var material = [];

  for (var i = 0; i < drawingInfo.materials.length; i++) {
    const color = drawingInfo.materials[i].color;
    material.push(color.r);
    material.push(color.g);
    material.push(color.b);
    material.push(color.a);
    material.push(drawingInfo.materials[i].emission.r);
    material.push(drawingInfo.materials[i].emission.g);
    material.push(drawingInfo.materials[i].emission.b);
    material.push(drawingInfo.materials[i].emission.a);
  }

  var emission = new Float32Array(material);

  const materialBuffer = device.createBuffer({
    size: emission.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  device.queue.writeBuffer(materialBuffer, 0, emission);

  build_bsp_tree(drawingInfo, device, buffers);

  // Bindings
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer_f } },
        { binding: 1, resource: { buffer: uniformBuffer_ui } },
        { binding: 2, resource: { buffer: buffers.attribs } },
        { binding: 3, resource: { buffer: buffers.indices } },
        { binding: 4, resource: { buffer: materialBuffer } },
        { binding: 5, resource: { buffer: buffers.aabb } },
        { binding: 6, resource: { buffer: buffers.treeIds } },
        { binding: 7, resource: { buffer: buffers.bspTree } },
        { binding: 8, resource: { buffer: buffers.bspPlanes } },
        { binding: 9, resource: textures.renderDst.createView() },
      ],
    }
  );

  // Camera
  const aspect = canvas.width / canvas.height;
  var cam_const = 1.0;
  var gamma = 1;
  var shader = 5;

  var uniforms_f = new Float32Array([aspect, cam_const, gamma, shader]);
  device.queue.writeBuffer(uniformBuffer_f, 0, uniforms_f);

  // Event listeners
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
  progLoadToggle.addEventListener("click", () => {
    if (progLoad) {
      progLoad = false;
    } else {
      progLoad = true;
    }
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


  function animate() {
    uniforms_f[1] = cam_const;
    device.queue.writeBuffer(uniformBuffer_f, 0, uniforms_f);
    render();

    if (progLoad) {
      uniforms_ui[2] += 1;
      device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);
      requestAnimationFrame(animate);
    }
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
    uniforms_ui[2] += 1;
    const encoder = device.createCommandEncoder();


    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" },
        { view: textures.renderSrc.createView(), loadOp: "load", storeOp: "store" }
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();

    encoder.copyTextureToTexture(
      { texture: textures.renderSrc },
      { texture: textures.renderDst },
      [textures.width, textures.height]
    );

    // Finish the command buffer and immediately submit it.
    device.queue.submit([encoder.finish()]);
  }
}