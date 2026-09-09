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
      if (!['brick','stone','residence','residenceShade','paving','walk','road','roof','roofFlat','metal','grass','turf','turfLight','track','trackPurple','trackBlue','courtBlue','water'].includes(kind)) continue;
      material.customProgramCacheKey = () => `campus-surface-v3-${kind}`;
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
            vec2 campusWall = abs(vCampusNormal.y) > .5 ? vCampusPosition.xz : vec2(dot(vCampusPosition, normalize(vec3(vCampusNormal.z,0.0,-vCampusNormal.x))), vCampusPosition.y);
            vec2 campusUV = campusWall / vec2(.32,.11);
            campusUV.x += mod(floor(campusUV.y), 2.0) * .5;
            vec2 campusCell = fract(campusUV), campusAA = fwidth(campusUV);
            vec2 campusEdge = min(campusCell,1.0-campusCell);
            float campusJoint = smoothstep(.024,.024+max(campusAA.x,campusAA.y),min(campusEdge.x,campusEdge.y));
            float campusDetail = 1.0-smoothstep(.35,1.1,max(campusAA.x,campusAA.y));
            float campusBrick = .94 + .10 * campusHash(floor(campusUV));
            diffuseColor.rgb *= mix(1.0,mix(.69,campusBrick,campusJoint),campusDetail);
            campusRelief = .008 * campusJoint * campusDetail;
            campusRoughness = .96 + .04 * campusHash(floor(campusUV));
          `;
        } else if (['paving','walk','stone','residence','residenceShade'].includes(kind)) {
          surface = `
            vec2 campusPlane = abs(vCampusNormal.y) > .5 ? vCampusPosition.xz : vec2(dot(vCampusPosition,normalize(vec3(vCampusNormal.z,0.0,-vCampusNormal.x))),vCampusPosition.y);
            vec2 campusUV = campusPlane / ${['paving','walk'].includes(kind) ? 'vec2(.64,.64)' : 'vec2(.85,.48)'};
            vec2 campusCell = fract(campusUV), campusAA = fwidth(campusUV);
            float campusEdge = min(min(campusCell.x,1.0-campusCell.x),min(campusCell.y,1.0-campusCell.y));
            float campusLine = smoothstep(.007,.007+max(campusAA.x,campusAA.y),campusEdge);
            float campusDetail = 1.0-smoothstep(.3,1.0,max(campusAA.x,campusAA.y));
            diffuseColor.rgb *= mix(1.0,mix(.72,.96+.07*campusHash(floor(campusUV)),campusLine),campusDetail);
            campusRelief = .006 * campusLine * campusDetail;
          `;
        } else if (kind === 'roofFlat') {
          surface = `
            vec2 campusUV = vCampusPosition.xz / 1.15;
            vec2 campusCell = fract(campusUV), campusAA = fwidth(campusUV);
            float campusEdge = min(min(campusCell.x,1.0-campusCell.x),min(campusCell.y,1.0-campusCell.y));
            float campusJoint = smoothstep(.012,.012+max(campusAA.x,campusAA.y),campusEdge);
            float campusDetail = 1.0-smoothstep(.35,1.1,max(campusAA.x,campusAA.y));
            diffuseColor.rgb *= mix(1.0,mix(.67,.97+.07*campusHash(floor(campusUV)),campusJoint),campusDetail);
            campusRelief = .012 * campusJoint * campusDetail;
            campusRoughness = .94+.06*campusNoise(vCampusPosition.xz*4.0);
          `;
        } else if (kind === 'roof') {
          surface = `
            vec2 campusUV = vCampusPosition.xz / vec2(.22,.42);
            float campusAA = max(fwidth(campusUV.x),fwidth(campusUV.y));
            float campusTile = .92+.1*cos(campusUV.x*6.2831);
            float campusDetail = 1.0-smoothstep(.3,1.0,campusAA);
            diffuseColor.rgb *= mix(1.0,campusTile,campusDetail);
            campusRelief = .01*cos(campusUV.x*6.2831)*campusDetail;
          `;
        } else if (kind === 'water') {
          surface = `
            float campusWave = sin(vCampusPosition.x*1.7+vCampusPosition.z*.5)*sin(vCampusPosition.z*2.3);
            diffuseColor.rgb *= .98+.025*campusWave;
            campusRelief = .016*campusWave;
          `;
        } else if (kind === 'metal') {
          surface = `
            campusRoughness = .92+.08*campusNoise(vCampusPosition.xz*2.0);
          `;
        } else {
          surface = `
            float campusGrain = campusNoise(vCampusPosition.xz*12.0);
            float campusPatch = campusNoise(vCampusPosition.xz*.17);
            diffuseColor.rgb *= .95 + .05*campusGrain + .07*campusPatch;
            campusRelief = .006*campusGrain*(1.0-smoothstep(.04,.15,length(fwidth(vCampusPosition.xz))));
          `;
        }
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat campusRelief = 0.0;\nfloat campusRoughness = 1.0;\n${surface}`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= campusRoughness;')
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            // Surface-gradient bump: derivative-scaled relief follows the actual facade orientation.
            vec3 campusDx=dFdx(-vViewPosition),campusDy=dFdy(-vViewPosition);
            vec3 campusRx=cross(campusDy,normal),campusRy=cross(normal,campusDx);
            float campusDet=dot(campusDx,campusRx);
            vec3 campusGradient=sign(campusDet)*(dFdx(campusRelief)*campusRx+dFdy(campusRelief)*campusRy);
            normal=normalize(max(abs(campusDet),1e-10)*normal-campusGradient);
          `);
      };
    }
  });
}
