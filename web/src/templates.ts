// D-046 layer 3 ("Where am I going"), D-053: four standard university presentations as a starting point.
// Every template has at least 4 topics so C1 (topic order, needs >= 4 clear topics) can give a level.
// Not thresholds: the user can change the time and edit, reorder or delete every topic before confirming.
import type { DraftTopic } from "./contract";

export interface PresentationTemplate { id: string; label: string; minutes: number; note?: string; topics: DraftTopic[] }

export const TEMPLATES: PresentationTemplate[] = [
  {
    id: "proposal", label: "สอบเค้าโครงโครงงาน", minutes: 10,
    topics: [
      { title: "ที่มาและความสำคัญของปัญหา", key_point: "สภาพปัญหา เหตุผล และแนวคิดในการแก้ปัญหา" },
      { title: "วัตถุประสงค์และขอบเขตของโครงงาน", key_point: "เป้าหมายหลัก กลุ่มเป้าหมาย และขอบเขตการทำงานของระบบ" },
      { title: "ทฤษฎีและระบบที่เกี่ยวข้อง", key_point: "หลักการ เทคโนโลยีที่ใช้ และข้อจำกัดของงานเดิม" },
      { title: "วิธีการดำเนินงานและแผนงาน", key_point: "สถาปัตยกรรม การออกแบบระบบ และแผนการดำเนินงาน" },
    ],
  },
  {
    id: "progress", label: "สอบความก้าวหน้าโครงงาน", minutes: 10,
    topics: [
      { title: "ทบทวนเป้าหมายและขอบเขตโครงงาน", key_point: "ภาพรวมของระบบและเป้าหมายที่กำหนดไว้" },
      { title: "ผลการดำเนินงานที่พัฒนาเสร็จแล้ว", key_point: "ส่วนประกอบหรือฟีเจอร์ที่พัฒนาเสร็จและผลการทดสอบเบื้องต้น" },
      { title: "ปัญหา อุปสรรค และแนวทางแก้ไข", key_point: "ข้อจำกัดทางเทคนิคที่พบระหว่างพัฒนาและวิธีแก้ไข" },
      { title: "แผนการดำเนินงานขั้นถัดไป", key_point: "งานที่เหลือและการเตรียมประเมินผลระบบ" },
    ],
  },
  {
    id: "defense", label: "สอบป้องกันโครงงานฉบับสมบูรณ์", minutes: 15,
    topics: [
      { title: "ที่มาของปัญหาและวัตถุประสงค์", key_point: "ความสำคัญของปัญหาและเป้าหมายของโครงงาน" },
      { title: "แนวคิด ทฤษฎี และงานที่เกี่ยวข้อง", key_point: "หลักการสำคัญและจุดเด่นเมื่อเทียบกับระบบอื่น" },
      { title: "การออกแบบและพัฒนาระบบ", key_point: "สถาปัตยกรรม กระบวนการทำงาน และวิธีการวัดผล" },
      { title: "ผลการดำเนินงานและการประเมินระบบ", key_point: "ผลลัพธ์ของระบบ ผลการทดสอบ และการประเมินผล" },
      { title: "สรุปผล ข้อจำกัด และข้อเสนอแนะ", key_point: "สรุปผลตามวัตถุประสงค์ ข้อจำกัด และแนวทางพัฒนาต่อยอด" },
    ],
  },
  {
    id: "seminar", label: "สัมมนา / นำเสนอบทความวิจัย", minutes: 10,
    topics: [
      { title: "บทนำและปัญหาการวิจัยของบทความ", key_point: "บริบท ช่องว่างงานวิจัย และวัตถุประสงค์ของผู้แต่ง" },
      { title: "แนวคิดและวิธีการที่บทความนำเสนอ", key_point: "กรอบแนวคิด สถาปัตยกรรม หรืออัลกอริทึมหลัก" },
      { title: "การทดลองและผลการวิจัย", key_point: "ชุดข้อมูล ตัวชี้วัด และผลการเปรียบเทียบประสิทธิภาพ" },
      { title: "สรุปจุดเด่น ข้อจำกัด และแนวทางประยุกต์ใช้", key_point: "ข้อดี ข้อสังเกต และสิ่งที่นำมาประยุกต์ต่อได้" },
    ],
  },
];
