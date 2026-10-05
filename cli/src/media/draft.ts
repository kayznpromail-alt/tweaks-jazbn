import { validateImages, type ImageRef } from "./images";

/** Ranges, not matching marker text, bind attachments to editor content. */
export class ImageDraft {
  text = "";
  marks: { start:number; end:number; image:ImageRef }[] = [];
  next = 1;
  recalled = false;
  update(text:string) {
    if(text===this.text)return;
    let start=0, oldEnd=this.text.length, end=text.length;
    while(start<oldEnd&&start<end&&this.text[start]===text[start])start++;
    while(oldEnd>start&&end>start&&this.text[oldEnd-1]===text[end-1]){oldEnd--;end--;}
    const delta=end-oldEnd;
    this.marks=this.marks.filter(mark=> {
      if(mark.end<=start)return true;
      if(mark.start>=oldEnd){mark.start+=delta;mark.end+=delta;return true;}
      return false;
    });
    this.text=text;
  }
  add(image:ImageRef, at=this.text.length) {
    validateImages([...this.images(),image]);
    const marker=`[image ${this.next++}]`,old=this.text;
    this.update(old.slice(0,at)+marker+old.slice(at));
    this.marks.push({start:at,end:at+marker.length,image});this.marks.sort((a,b)=>a.start-b.start);
    return marker;
  }
  images(){return this.marks.map(mark=>structuredClone(mark.image));}
  remove(index:number){const mark=this.marks[index];if(mark)this.update(this.text.slice(0,mark.start)+this.text.slice(mark.end));}
  clear(){this.text="";this.marks=[];this.next=1;this.recalled=false;}
  restore(text:string,images:ImageRef[]=[],positions?:number[]){
    this.clear();this.text=text;
    // Stored messages retain the original marker positions separately in the UI contract:
    // for legacy/manual markers do not invent a binding. Recalled images receive new markers.
    if(positions?.length===images.length){
      images.forEach((image,i)=>{const start=positions[i],match=/^\[image (\d+)\]/.exec(text.slice(start));if(!match)throw new Error("saved image marker is missing");this.marks.push({start,end:start+match[0].length,image});this.next=Math.max(this.next,Number(match[1])+1);});
    }else for(const image of images){this.text+=" ";this.add(image);}
    this.recalled=true;return this.text;
  }
}
