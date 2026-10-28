import { describe, expect, it } from "vitest";
import { exportCommentsCsv } from "../src/utils/export-csv";
import { makeComment } from "./fixtures";

describe("评论CSV导出", () => {
  it("支持中文、引号、换行和排名", () => {
    const csv = exportCommentsCsv([
      makeComment({ text: '中文"评论\n第二行' })
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"排名","评论内容","作者"');
    expect(csv).toContain('中文""评论\n第二行');
    expect(csv).toContain('"1"');
  });

  it("防止表格公式注入", () => {
    expect(exportCommentsCsv([makeComment({ text: "=1+1" })])).toContain(
      "'=1+1"
    );
  });

  it("空结果仍然保留表头", () => {
    expect(exportCommentsCsv([])).toContain("评论内容");
  });

  it("只导出清洗后的时间和归属地", () => {
    const csv = exportCommentsCsv([
      makeComment({
        publishTimeText: "2天前·四川 回复 分享 160",
        ipLocationText: "IP属地：四川"
      })
    ]);
    expect(csv).toContain('"2天前·四川"');
    expect(csv).not.toContain("视频标题");
    expect(csv).not.toContain("视频链接");
    expect(csv).not.toContain('"IP属地"');
  });
});
