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

  // Uniform f buffer
  const uniformBuffer_f = device.createBuffer({
    size: 16, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Uniform ui buffer
  var addressMenu = document.getElementById("addressmode");
  var filterMenu = document.getElementById("filtermode");

  const use_repeat = addressMenu.selectedIndex;
  const use_linear = filterMenu.selectedIndex;
  var subdivs = 1;
  var uniforms_ui = new Uint32Array([use_repeat, use_linear, subdivs*subdivs]);

  const uniformBuffer_ui = device.createBuffer({
    size: uniforms_ui.byteLength, // number of bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);

  // Texture
  const texture = await load_texture(device, "../common/grass.jpg");

  // Jitter buffer
  let jitter = new Float32Array(200); // allowing subdivs from 1 to 10
  const jitterBuffer = device.createBuffer({
    size: jitter.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });

  // Position buffer
  var drawingInfo = await readOBJFile("../objects/CornellBoxWithBlocks.obj", 0.5, true);

  const positionsBuffer = device.createBuffer({
    size: drawingInfo.vertices.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  device.queue.writeBuffer(positionsBuffer, 0, drawingInfo.vertices);
  
  // Index buffer
  const indicesBuffer = device.createBuffer({
    size: drawingInfo.indices.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  device.queue.writeBuffer(indicesBuffer, 0, drawingInfo.indices);

  // Normal buffer
  const normalBuffer = device.createBuffer({
    size: drawingInfo.indices.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  device.queue.writeBuffer(normalBuffer, 0, drawingInfo.normals);

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

  // Material indices buffer
  const materialIndicesBuffer = device.createBuffer({
    size: drawingInfo.mat_indices.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
  });
  device.queue.writeBuffer(materialIndicesBuffer, 0, drawingInfo.mat_indices);

  // Bindings
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer_f } },
        { binding: 1, resource: { buffer: uniformBuffer_ui } },
        { binding: 2, resource: texture.createView() },
        { binding: 3, resource: { buffer: jitterBuffer } },
        { binding: 4, resource: { buffer: positionsBuffer } },
        { binding: 5, resource: { buffer: indicesBuffer } },
        { binding: 6, resource: { buffer: normalBuffer } },
        { binding: 7, resource: { buffer: materialBuffer } },
        { binding: 8, resource: { buffer: materialIndicesBuffer } },
      ],
    }
  );

  // Camera
  const aspect = canvas.width / canvas.height;
  var cam_const = 1.0;
  var gamma = 1;
  var shader = 5;
  var pixelsize = 1 / canvas.height;
  var uniforms_f = new Float32Array([aspect, cam_const, gamma, shader]);
  device.queue.writeBuffer(uniformBuffer_f, 0, uniforms_f);

  compute_jitters(jitter, pixelsize, subdivs);
  device.queue.writeBuffer(jitterBuffer, 0, jitter);

  function compute_jitters(jitter, pixelsize, subdivs) {
    const step = pixelsize/subdivs;
    if(subdivs < 2) {
      jitter[0] = 0.0;
      jitter[1] = 0.0;
    } else {
      for(var i = 0; i < subdivs; ++i)
        for(var j = 0; j < subdivs; ++j) {
          const idx = (i*subdivs + j)*2;
          jitter[idx] = (Math.random() + j) * step - pixelsize*0.5;
          jitter[idx + 1] = (Math.random() + i)*step - pixelsize*0.5;
      }
    }
  }

  var increaseButton = document.getElementById("inc_subdiv");
  var decreaseButton = document.getElementById("dec_subdiv");

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
  increaseButton.addEventListener("click", () => {
    if (subdivs < 10) {
      subdivs += 1;
    }
    compute_jitters(jitter, pixelsize, subdivs);
    uniforms_ui[2] = subdivs * subdivs;
    device.queue.writeBuffer(jitterBuffer, 0, jitter);
    device.queue.writeBuffer(uniformBuffer_ui, 0, uniforms_ui);
    requestAnimationFrame(animate);
  });
  decreaseButton.addEventListener("click", () => {
    if (subdivs > 1) {
      subdivs -= 1;
    }
    compute_jitters(jitter, pixelsize, subdivs);
    uniforms_ui[2] = subdivs * subdivs;
    device.queue.writeBuffer(jitterBuffer, 0, jitter);
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