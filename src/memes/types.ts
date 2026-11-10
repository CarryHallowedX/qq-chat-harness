/** §8.1 表情包数据结构（与宿主现役图库语义对齐：tag/caption/keywords/packId） */

export interface MemeEntry {
  id: string;
  /** 相对 memes/images/ 的路径（M1 归一化为纯文件名，防路径逃逸） */
  file: string;
  /** 情绪枚举: happy/angry/sad/shy/confused/daily… */
  tag: string;
  /** 一句话中文描述 */
  caption: string;
  /** 空格分隔检索词 */
  keywords: string[];
  /** 可选图库分组 */
  packId?: string;
  useCount: number;
  addedAt: number;
}
