"use client";

/* eslint-disable react-hooks/immutability, react-hooks/refs --
   React Three Fiber anima mutando los objetos 3D (posición, rotación, escala) dentro de useFrame, fuera del render de
   React: es el patrón documentado de la librería y no provoca renders. Estas reglas del compilador no lo distinguen. */

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh, MeshPhysicalMaterial } from "three";

// Animales en 3D de los agentes, armados con formas simples (esferas, conos, toros) y un material tipo juguete
// de vinilo: no hay modelos descargados, todo sale de este archivo. El zorro con auriculares atiende; el búho con
// anteojos analiza. Cada uno reacciona a su estado y sigue al cursor con la cabeza.

export type AnimalKind = "attention" | "analytic";
export type AnimalMood = "working" | "idle" | "waiting" | "asleep";

type SceneProps = { kind: AnimalKind; mood: AnimalMood; delay: number; animate: boolean; visible: boolean };

const BRAND = "#22b8c9";
const BRAND_DEEP = "#0a7f8c";

// Material brillante y suave, como un muñeco de vinilo.
function Toy({ color, rough = 0.45, emissive, emissiveIntensity = 0 }: { color: string; rough?: number; emissive?: string; emissiveIntensity?: number }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={rough}
      clearcoat={0.7}
      clearcoatRoughness={0.25}
      sheen={0.3}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissiveIntensity}
    />
  );
}

// Ojo negro brillante con un punto de luz. El grupo se achata para parpadear o dormir.
function Eye({ position, size = 0.085, eyeRef }: { position: [number, number, number]; size?: number; eyeRef: (node: Group | null) => void }) {
  return (
    <group position={position} ref={eyeRef}>
      <mesh>
        <sphereGeometry args={[size, 24, 24]} />
        <meshPhysicalMaterial color="#0b1016" roughness={0.15} clearcoat={1} />
      </mesh>
      <mesh position={[size * 0.35, size * 0.4, size * 0.75]}>
        <sphereGeometry args={[size * 0.28, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

type Rig = {
  root: React.RefObject<Group | null>;
  body: React.RefObject<Group | null>;
  head: React.RefObject<Group | null>;
  eyes: React.RefObject<Array<Group | null>>;
  // Cola (zorro) o ala izquierda (búho).
  extraA: React.RefObject<Group | null>;
  // Ala derecha (búho).
  extraB: React.RefObject<Group | null>;
  // Luz del micrófono (zorro) o del puente de los anteojos (búho).
  glow: React.RefObject<Mesh | null>;
};

function useRig(): Rig {
  return {
    root: useRef<Group>(null),
    body: useRef<Group>(null),
    head: useRef<Group>(null),
    eyes: useRef<Array<Group | null>>([]),
    extraA: useRef<Group>(null),
    extraB: useRef<Group>(null),
    glow: useRef<Mesh>(null),
  };
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

// Movimiento según el estado. Todo es suave (lerp) para que los cambios de estado no salten.
function useAnimation(rig: Rig, kind: AnimalKind, mood: AnimalMood, delay: number, animate: boolean) {
  const nextBlink = useRef(2 + delay);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + delay;
    const step = Math.min(1, delta * 6);
    const asleep = mood === "asleep";
    const working = mood === "working";

    if (!animate) {
      // Sin animaciones: pose quieta, con los ojos según si duerme o no.
      rig.eyes.current.forEach((eye) => eye?.scale.set(1, asleep ? 0.12 : 1, 1));
      if (rig.head.current) rig.head.current.rotation.x = asleep ? 0.28 : 0;
      return;
    }

    // Respira y flota apenas.
    const breath = Math.sin(t * (asleep ? 1.2 : 2)) * (asleep ? 0.03 : 0.02);
    rig.body.current?.scale.set(1 + breath * 0.5, 1 + breath, 1 + breath * 0.5);
    if (rig.root.current) {
      rig.root.current.position.y = asleep ? 0 : Math.sin(t * 1.3) * 0.04;
      rig.root.current.rotation.y = lerp(rig.root.current.rotation.y, asleep ? 0 : Math.sin(t * 0.4) * 0.12, step * 0.3);
    }

    // La cabeza sigue al cursor; dormido, cae hacia adelante.
    const head = rig.head.current;
    if (head) {
      const bob = working ? Math.sin(t * 6) * 0.05 : 0;
      const tilt = mood === "waiting" ? Math.sin(t * 1.6) * 0.18 : 0;
      head.rotation.y = lerp(head.rotation.y, asleep ? 0 : state.pointer.x * 0.55, step);
      head.rotation.x = lerp(head.rotation.x, asleep ? 0.3 : -state.pointer.y * 0.3 + bob, step);
      head.rotation.z = lerp(head.rotation.z, tilt, step);
    }

    // Parpadeo cada tanto; dormido, ojos cerrados.
    let open = 1;
    if (asleep) open = 0.12;
    else if (t > nextBlink.current) {
      const phase = t - nextBlink.current;
      if (phase < 0.16) open = Math.max(0.1, Math.abs(Math.cos((phase / 0.16) * Math.PI)));
      else nextBlink.current = t + 2.5 + Math.random() * 3;
    }
    rig.eyes.current.forEach((eye) => {
      if (eye) eye.scale.y = lerp(eye.scale.y, open, Math.min(1, delta * 30));
    });

    // Cola del zorro o alas del búho.
    if (kind === "attention" && rig.extraA.current) {
      const wag = asleep ? 0.05 : working ? 0.55 : 0.2;
      rig.extraA.current.rotation.z = Math.sin(t * (working ? 9 : 2.2)) * wag - 0.3;
    }
    if (kind === "analytic") {
      const flap = working ? Math.abs(Math.sin(t * 8)) * 0.45 : asleep ? 0 : Math.abs(Math.sin(t * 1.5)) * 0.06;
      if (rig.extraA.current) rig.extraA.current.rotation.z = 0.15 + flap;
      if (rig.extraB.current) rig.extraB.current.rotation.z = -0.15 - flap;
    }

    // Luz de marca: late trabajando, ámbar esperando aprobación, apagada durmiendo.
    const material = rig.glow.current?.material as MeshPhysicalMaterial | undefined;
    if (material) {
      const target = asleep ? 0 : working ? 1.2 + Math.sin(t * 6) * 0.8 : mood === "waiting" ? 1 + Math.sin(t * 3) * 0.6 : 0.5;
      material.emissiveIntensity = lerp(material.emissiveIntensity, target, step);
      material.emissive.set(mood === "waiting" ? "#e8a948" : BRAND);
    }
  });
}

function Fox({ mood, delay, animate }: { mood: AnimalMood; delay: number; animate: boolean }) {
  const rig = useRig();
  useAnimation(rig, "attention", mood, delay, animate);
  const orange = "#e9803d";
  const cream = "#fbeee0";
  const dark = "#3a2219";

  return (
    <group ref={rig.root} position={[0, -0.12, 0]}>
      <group ref={rig.body}>
        <mesh position={[0, -0.62, 0]} scale={[1, 0.95, 0.85]}>
          <sphereGeometry args={[0.6, 40, 40]} />
          <Toy color={orange} />
        </mesh>
        <mesh position={[0, -0.6, 0.33]} scale={[0.95, 1.1, 0.55]}>
          <sphereGeometry args={[0.4, 32, 32]} />
          <Toy color={cream} />
        </mesh>
        {[-0.26, 0.26].map((x) => (
          <mesh key={x} position={[x, -1.12, 0.28]} scale={[1, 0.7, 1.2]}>
            <sphereGeometry args={[0.15, 20, 20]} />
            <Toy color={dark} rough={0.6} />
          </mesh>
        ))}
        {/* Cola: una esfera estirada, con la punta blanca. */}
        <group ref={rig.extraA} position={[0.45, -0.85, -0.35]}>
          <mesh position={[0.32, 0.25, 0]} rotation={[0, 0, -0.8]} scale={[0.55, 1.25, 0.55]}>
            <sphereGeometry args={[0.32, 28, 28]} />
            <Toy color={orange} />
          </mesh>
          <mesh position={[0.62, 0.55, 0]} scale={[0.75, 0.75, 0.75]}>
            <sphereGeometry args={[0.24, 24, 24]} />
            <Toy color={cream} />
          </mesh>
        </group>
      </group>

      <group ref={rig.head} position={[0, 0.25, 0.05]}>
        <mesh scale={[1.12, 0.92, 0.95]}>
          <sphereGeometry args={[0.6, 48, 48]} />
          <Toy color={orange} />
        </mesh>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, -0.16, 0.32]} scale={[1, 0.8, 0.8]}>
            <sphereGeometry args={[0.28, 28, 28]} />
            <Toy color={cream} />
          </mesh>
        ))}
        <mesh position={[0, -0.15, 0.52]} scale={[1, 0.75, 1.15]}>
          <sphereGeometry args={[0.2, 28, 28]} />
          <Toy color={cream} />
        </mesh>
        <mesh position={[0, -0.09, 0.74]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshPhysicalMaterial color={dark} roughness={0.2} clearcoat={1} />
        </mesh>
        <Eye
          position={[-0.22, 0.06, 0.5]}
          eyeRef={(node) => {
            rig.eyes.current[0] = node;
          }}
        />
        <Eye
          position={[0.22, 0.06, 0.5]}
          eyeRef={(node) => {
            rig.eyes.current[1] = node;
          }}
        />
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.38, 0.5, 0]} rotation={[0, 0, -side * 0.38]}>
            <mesh>
              <coneGeometry args={[0.2, 0.46, 24]} />
              <Toy color={orange} />
            </mesh>
            <mesh position={[0, -0.04, 0.08]} scale={[0.6, 0.75, 0.4]}>
              <coneGeometry args={[0.2, 0.46, 24]} />
              <Toy color={dark} rough={0.7} />
            </mesh>
          </group>
        ))}
        {/* Auriculares color petróleo: es el agente que atiende. */}
        <mesh position={[0, 0.06, 0]}>
          <torusGeometry args={[0.66, 0.035, 12, 48, Math.PI]} />
          <Toy color={BRAND_DEEP} rough={0.3} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.66, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 24]} />
            <Toy color={BRAND_DEEP} rough={0.3} />
          </mesh>
        ))}
        <mesh position={[-0.52, -0.2, 0.32]} rotation={[0.2, 0.6, 1.1]}>
          <cylinderGeometry args={[0.018, 0.018, 0.42, 8]} />
          <Toy color={BRAND_DEEP} />
        </mesh>
        <mesh ref={rig.glow} position={[-0.33, -0.3, 0.5]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <Toy color={BRAND} emissive={BRAND} emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function Owl({ mood, delay, animate }: { mood: AnimalMood; delay: number; animate: boolean }) {
  const rig = useRig();
  useAnimation(rig, "analytic", mood, delay, animate);
  const brown = "#8a5a3c";
  const wing = "#6e4530";
  const light = "#f1e2c6";
  const amber = "#f2b33d";

  return (
    <group ref={rig.root} position={[0, -0.1, 0]}>
      <group ref={rig.body}>
        <mesh position={[0, -0.5, 0]} scale={[1, 1.08, 0.9]}>
          <sphereGeometry args={[0.72, 48, 48]} />
          <Toy color={brown} />
        </mesh>
        <mesh position={[0, -0.6, 0.36]} scale={[0.85, 1, 0.5]}>
          <sphereGeometry args={[0.5, 32, 32]} />
          <Toy color={light} />
        </mesh>
        {[-0.14, 0, 0.14].map((x) => (
          <mesh key={x} position={[x, -0.5 - Math.abs(x) * 0.4, 0.6]} scale={[1, 0.5, 0.4]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <Toy color={brown} />
          </mesh>
        ))}
        <group ref={rig.extraA} position={[-0.66, -0.35, 0]}>
          <mesh position={[0, -0.2, 0]} scale={[0.35, 0.85, 0.6]}>
            <sphereGeometry args={[0.45, 28, 28]} />
            <Toy color={wing} />
          </mesh>
        </group>
        <group ref={rig.extraB} position={[0.66, -0.35, 0]}>
          <mesh position={[0, -0.2, 0]} scale={[0.35, 0.85, 0.6]}>
            <sphereGeometry args={[0.45, 28, 28]} />
            <Toy color={wing} />
          </mesh>
        </group>
        {[-0.2, 0.2].map((x) => (
          <mesh key={x} position={[x, -1.22, 0.25]} scale={[1.2, 0.5, 1]}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <Toy color={amber} />
          </mesh>
        ))}
      </group>

      <group ref={rig.head} position={[0, 0.38, 0]}>
        <mesh scale={[1.12, 0.9, 0.95]}>
          <sphereGeometry args={[0.62, 48, 48]} />
          <Toy color={brown} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.25, 0.02, 0.42]} scale={[1, 1, 0.35]}>
            <sphereGeometry args={[0.28, 32, 32]} />
            <Toy color={light} />
          </mesh>
        ))}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.25, 0.03, 0.5]}>
            <mesh>
              <sphereGeometry args={[0.15, 28, 28]} />
              <meshPhysicalMaterial color={amber} roughness={0.25} clearcoat={1} />
            </mesh>
            <Eye
              position={[0, 0, 0.08]}
              size={0.095}
              eyeRef={(node) => {
                rig.eyes.current[side < 0 ? 0 : 1] = node;
              }}
            />
          </group>
        ))}
        <mesh position={[0, -0.16, 0.6]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.07, 0.18, 16]} />
          <Toy color={amber} rough={0.3} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.4, 0.55, 0]} rotation={[0, 0, -side * 0.45]}>
            <coneGeometry args={[0.12, 0.34, 16]} />
            <Toy color={brown} />
          </mesh>
        ))}
        {/* Anteojos color petróleo: es el agente que analiza. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.25, 0.03, 0.63]}>
            <torusGeometry args={[0.18, 0.022, 12, 40]} />
            <Toy color={BRAND_DEEP} rough={0.3} />
          </mesh>
        ))}
        <mesh ref={rig.glow} position={[0, 0.05, 0.66]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 0.14, 8]} />
          <Toy color={BRAND} emissive={BRAND} emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

// Sombra suave bajo el animal: un disco oscuro y transparente (más barato que sombras reales).
function GroundShadow() {
  return (
    <mesh position={[0, -1.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.75, 40]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.16} depthWrite={false} />
    </mesh>
  );
}

export default function AnimalScene({ kind, mood, delay, animate, visible }: SceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.1, 5.4], fov: 32 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      // Fuera de pantalla no se dibuja; sin animaciones, se dibuja solo cuando cambia algo.
      frameloop={!visible ? "never" : animate ? "always" : "demand"}
      style={{ pointerEvents: "none" }}
    >
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#dcebf0", "#08151f", 0.7]} />
      <directionalLight position={[3, 4, 5]} intensity={1.7} />
      <pointLight position={[-2.5, 1.5, -2]} intensity={6} color={BRAND} />
      {kind === "attention" ? <Fox mood={mood} delay={delay} animate={animate} /> : <Owl mood={mood} delay={delay} animate={animate} />}
      <GroundShadow />
    </Canvas>
  );
}
