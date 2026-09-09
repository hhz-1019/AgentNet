import * as THREE from 'three';

// World-scale surface detail. Photographs are references, never baked onto the buildings.
// These shader details supplement the standard PBR colors retained by the GLB export.
export function addCampusSurfaceDetail(model: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue;
      seen.add(material);
      const kind = material.name;
      if (!['brick','stone','residence','residenceShade','paving','walk','road','roof','grass','turf','turfLight','track','trackBlue','courtBlue','water'].includes(kind)) continue;
      material.customProgramCacheKey = () => `campus-surface-v2-${kind}`;
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
          varying vec3 vCampusPosition;
          varying vec3 vCampusNormal;
        `).replace('#include <project_vertex>', `#include <project_vertex>
          vec4 campusPosition = vec4(transformed, 1.0);
          vec3 campusNormal = objectNormal;
          #ifdef USE_INSTANCING
            campusPosition = instanceMatrix * campusPosition;
            campusNormal = mat3(instanceMatrix) * campusNormal;
          #endif
          vCampusPosition = (modelMatrix * campusPosition).xyz;
          vCampusNormal = normalize(mat3(modelMatrix) * campusNormal);
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vCampusPosition;
          varying vec3 vCampusNormal;
          float campusHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float campusNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(campusHash(i),campusHash(i+vec2(1,0)),f.x),mix(campusHash(i+vec2(0,1)),campusHash(i+vec2(1,1)),f.x),f.y);
          }
        `);
        let surface = '';
        if (kind === 'brick') {
          surface = `
            vec2 campusWall = vec2(abs(vCampusNormal.x) > abs(vCampusNormal.z) ? vCampusPosition.z : vCampusPosition.x, vCampusPosition.y);
            vec2 campusUV = campusWall / vec2(.36,.115);
            campusUV.x += mod(floor(campusUV.y), 2.0) * .5;
            vec2 campusCell = fract(campusUV), campusAA = fwidth(campusUV);
            vec2 campusEdge = min(campusCell,1.0-campusCell);
            float campusJoint = smoothstep(.024,.024+max(campusAA.x,campusAA.y),min(campusEdge.x,campusEdge.y));
            float campusDetail = 1.0-smoothstep(.35,1.1,max(campusAA.x,campusAA.y));
            float campusBrick = .87 + .22 * campusHash(floor(campusUV));
            diffuseColor.rgb *= mix(1.0,mix(.73,campusBrick,campusJoint),campusDetail);
          `;
        } else if (['paving','walk','stone','residence','residenceShade'].includes(kind)) {
          surface = `
            vec2 campusPlane = abs(vCampusNormal.y) > .5 ? vCampusPosition.xz : vec2(abs(vCampusNormal.x) > abs(vCampusNormal.z) ? vCampusPosition.z : vCampusPosition.x,vCampusPosition.y);
            vec2 campusUV = campusPlane / ${['paving','walk'].includes(kind) ? 'vec2(.64,.64)' : 'vec2(1.45,.72)'};
            vec2 campusCell = fract(campusUV), campusAA = fwidth(campusUV);
            float campusEdge = min(min(campusCell.x,1.0-campusCell.x),min(campusCell.y,1.0-campusCell.y));
            float campusLine = smoothstep(.007,.007+max(campusAA.x,campusAA.y),campusEdge);
            float campusDetail = 1.0-smoothstep(.3,1.0,max(campusAA.x,campusAA.y));
            diffuseColor.rgb *= mix(1.0,mix(.78,.96+.07*campusHash(floor(campusUV)),campusLine),campusDetail);
          `;
        } else if (kind === 'roof') {
          surface = `
            vec2 campusUV = vCampusPosition.xz / vec2(.22,.42);
            float campusAA = max(fwidth(campusUV.x),fwidth(campusUV.y));
            float campusTile = .92+.1*cos(campusUV.x*6.2831);
            diffuseColor.rgb *= mix(1.0,campusTile,1.0-smoothstep(.3,1.0,campusAA));
          `;
        } else if (kind === 'water') {
          surface = `
            float campusWave = sin(vCampusPosition.x*1.7+vCampusPosition.z*.5)*sin(vCampusPosition.z*2.3);
            diffuseColor.rgb *= .98+.025*campusWave;
          `;
        } else {
          surface = `
            float campusGrain = campusNoise(vCampusPosition.xz*12.0);
            float campusPatch = campusNoise(vCampusPosition.xz*.17);
            diffuseColor.rgb *= .95 + .05*campusGrain + .07*campusPatch;
          `;
        }
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${surface}`);
      };
    }
  });
}
