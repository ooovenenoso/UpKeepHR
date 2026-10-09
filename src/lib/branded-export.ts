import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { displayDate,localDate } from "./domain";
const clean=(v:unknown)=>String(v??"—").replace(/[^\x20-\x7e\u00a0-\u00ff]/g,"");
export async function brandedBytes(title:string,headers:string[],rows:unknown[][],format:string,filters:string) {
 const logo=await fs.readFile(path.join(process.cwd(),"public/brand/upkeephr-logo.png"));
 if(format==="xlsx") {
   const book=new ExcelJS.Workbook();book.creator="UpKeepHR";book.created=new Date();
   const sheet=book.addWorksheet("Reporte",{views:[{state:"frozen",ySplit:8}]});
   sheet.addImage(book.addImage({buffer:logo as unknown as ExcelJS.Buffer,extension:"png"}),{tl:{col:0,row:0},ext:{width:150,height:116}});
   sheet.mergeCells(1,3,2,Math.max(4,headers.length));sheet.getCell(1,3).value=title;sheet.getCell(1,3).font={bold:true,size:18,color:{argb:"FF243D91"}};
   sheet.mergeCells(3,3,3,Math.max(4,headers.length));sheet.getCell(3,3).value="UpKeepHR · Recursos Humanos";
   sheet.mergeCells(4,3,4,Math.max(4,headers.length));sheet.getCell(4,3).value=`Fecha: ${displayDate(localDate())} · Puerto Rico`;
   sheet.mergeCells(5,3,5,Math.max(4,headers.length));sheet.getCell(5,3).value=filters;sheet.getCell(5,3).alignment={wrapText:true};
   sheet.getRow(8).values=headers;
   headers.forEach((h,i)=>{sheet.getColumn(i+1).width=Math.min(38,Math.max(18,h.length+4));});
   const heading=sheet.getRow(8);heading.height=28;heading.font={bold:true,color:{argb:"FFFFFFFF"}};heading.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF243D91"}};
   rows.forEach((values,i)=>{const row=sheet.addRow(values.map(v=>v??"—"));row.height=30;row.alignment={vertical:"middle",wrapText:true};if(i%2===0)row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF2F5FC"}};});
   sheet.autoFilter={from:{row:8,column:1},to:{row:8+rows.length,column:headers.length}};
   sheet.pageSetup={orientation:"landscape",paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:"1:8"};
   return new Uint8Array(await book.xlsx.writeBuffer() as ArrayBuffer);
 }
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),mark=await pdf.embedPng(logo);
 pdf.setTitle(title);pdf.setAuthor("UpKeepHR");
 const wide=headers.length>10,W=wide?1191:842,H=wide?842:595,left=30,width=W-60,col=width/Math.max(1,headers.length),tableTop=H-120;
 let page=pdf.addPage([W,H]),y=450;
 const wrap=(text:string,max:number,face=font)=>{const result:string[]=[];let line="";for(const word of text.split(/\s+/)){if(face.widthOfTextAtSize((line?line+" ":"")+word,8)>max&&line){result.push(line);line="";}if(face.widthOfTextAtSize(word,8)>max){if(line){result.push(line);line="";}let chunk="";for(const ch of word){if(face.widthOfTextAtSize(chunk+ch,8)>max){result.push(chunk);chunk="";}chunk+=ch;}line=chunk;}else line+=(line?" ":"")+word;}if(line)result.push(line);return result.length?result:["—"]};
 const headingLines=headers.map(h=>wrap(clean(h),col-10,bold)),headingHeight=Math.max(22,...headingLines.map(l=>l.length*11+10));
 const header=()=>{page.drawImage(mark,{x:left,y:H-100,width:100,height:77.3});page.drawText(clean(title),{x:150,y:H-44,size:17,font:bold,color:rgb(.14,.24,.57)});page.drawText("UpKeepHR · Recursos Humanos",{x:150,y:H-66,size:10,font});page.drawText(`Fecha: ${displayDate(localDate())} · ${rows.length} registros · Puerto Rico`,{x:150,y:H-85,size:9,font});page.drawText(clean(filters).slice(0,145),{x:left,y:H-115,size:8,font});page.drawRectangle({x:left,y:tableTop-headingHeight,width,height:headingHeight,color:rgb(.14,.24,.57)});headingLines.forEach((lines,i)=>lines.forEach((line,j)=>page.drawText(line,{x:left+i*col+5,y:tableTop-13-j*11,size:8,font:bold,color:rgb(1,1,1)})));y=tableTop-headingHeight;};
 header();
 rows.forEach((row,index)=>{const lines=row.map(v=>wrap(clean(v),col-10));const height=Math.max(26,...lines.map(l=>l.length*11+10));if(y-height<38){page=pdf.addPage([W,H]);header();}if(index%2===0)page.drawRectangle({x:left,y:y-height,width,height,color:rgb(.95,.96,.99)});lines.forEach((cells,i)=>cells.forEach((line,j)=>page.drawText(line,{x:left+i*col+5,y:y-12-j*11,size:8,font})));y-=height;});
 if(!rows.length)page.drawText("No hay registros para los filtros seleccionados.",{x:left,y:y-24,size:10,font});
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:left,y:28},end:{x:W-left,y:28},color:rgb(.14,.24,.57),thickness:1});p.drawText(`UpKeepHR · ${i+1} / ${pages.length}`,{x:left,y:15,size:8,font});});
 return await pdf.save();
}
