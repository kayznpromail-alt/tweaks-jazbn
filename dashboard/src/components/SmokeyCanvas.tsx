import { useEffect, useRef } from 'react';

const VS = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0,1);}`;
const FS = `precision mediump float;
uniform vec2 iResolution;uniform float iTime;uniform vec2 iMouse;uniform vec3 u_color;
void main(){
  vec2 uv=gl_FragCoord.xy/iResolution;
  vec2 c=(2.0*gl_FragCoord.xy-iResolution.xy)/min(iResolution.x,iResolution.y);
  float t=iTime*0.5;
  vec2 m=iMouse/iResolution;
  vec2 r=2.0*m-1.0;
  vec2 d=c;
  for(float i=1.0;i<8.0;i++){
    d.x+=0.5/i*cos(i*2.0*d.y+t+r.x*3.1415);
    d.y+=0.5/i*cos(i*2.0*d.x+t+r.y*3.1415);
  }
  float w=abs(sin(d.x+d.y+t));
  float g=smoothstep(0.9,0.2,w);
  gl_FragColor=vec4(u_color*g,1.0);
}`;

export default function SmokeyCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl');
    if (!gl) return;

    function resize() {
      canvas!.width = canvas!.clientWidth * (window.devicePixelRatio || 1);
      canvas!.height = canvas!.clientHeight * (window.devicePixelRatio || 1);
    }
    resize();
    window.addEventListener('resize', resize);

    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uMouse = gl.getUniformLocation(prog, 'iMouse');
    const uColor = gl.getUniformLocation(prog, 'u_color');

    let mx = canvas.width * 0.5;
    let my = canvas.height * 0.5;

    const onMove = (e: MouseEvent) => {
      const r = canvas!.getBoundingClientRect();
      mx = (e.clientX - r.left) * (canvas!.width / r.width);
      my = canvas!.height - (e.clientY - r.top) * (canvas!.height / r.height);
    };
    canvas.addEventListener('mousemove', onMove);

    const start = performance.now();
    let raf: number;
    (function loop() {
      resize();
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, (performance.now() - start) / 1000);
      gl!.uniform2f(uMouse, mx, my);
      gl!.uniform3f(uColor, 0.424, 0.361, 0.906);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMove);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;
}
