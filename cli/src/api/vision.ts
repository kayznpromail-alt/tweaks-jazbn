import catalogue from "./vision-catalogue.json";
export interface VisionMetadata {version:1;status:"verified"|"unsupported"|"unknown";verifiedAt?:string;evidence?:string}
export function modelVision(id:string):VisionMetadata {
  const value=(catalogue as Record<string,VisionMetadata>)[id];
  return value?{...value}:{version:1,status:"unknown"};
}
