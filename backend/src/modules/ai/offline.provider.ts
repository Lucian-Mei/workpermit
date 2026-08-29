import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, AiMode } from './ai-provider.interface';

// 离线演示分析：无需任何 API Key，按规则 + 关键词生成“像那么回事”的 EHS 分析，
// 仅用于本地/沙箱无密钥时体验 AI 分析流程。生产请切换到真实大模型（deepseek/豆包/kimi/元宝等）。
@Injectable()
export class OfflineProvider implements AiProvider {
  readonly name = 'offline';
  private readonly logger = new Logger(OfflineProvider.name);

  async chat(system: string, user: string, opts?: { mode?: AiMode }): Promise<string> {
    const text = (user + ' ' + system).toLowerCase();
    const rule = this.matchRule(text);
    const mode = opts?.mode || 'hazard';

    if (mode === 'work_risk') {
      const risk = `本次作业主要危险有害因素为「${rule.cat}」相关风险，作业环境中可能存在${rule.sugHint}。若控制措施不到位，可能导致${rule.level}事故。建议严格执行作业票制度与 JSA（工作安全分析），作业前完成安全交底。`;
      const suggestions = rule.measures.split('；').map((s) => s.trim()).filter(Boolean);
      return risk + '\n\n防护措施清单：\n' + suggestions.map((s) => '- ' + s).join('\n');
    }

    if (mode === 'work_review') {
      return [
        '一、是否还存在未考虑到的其他风险：',
        '1）交叉作业与周边设备干扰风险；2）极端天气/夜间照明不足带来的衍生风险；3）应急预案与救援器材是否可用、人员是否熟知；4）危险作业人员资质与证件有效期复核。',
        '',
        '二、已填防护措施是否到位：',
        '申请人已填措施基本覆盖主要风险，但仍建议补充：作业前安全交底签字留痕、现场监护人持证且全程在位、应急联络方式上墙公示、完工后现场恢复与验收。总体结论：措施基本到位，略作补充即可批准。',
      ].join('\n');
    }

    // JSA 工作安全分析：按步骤逐条返回 [{step, hazard, risk, control}]（JSON 数组）。
    // 离线规则：1) 按步骤关键词匹配详细规则；2) 多规则时累加；3) 兜底不重复模板话术。
    if (mode === 'jsa') {
      const stepBlock = (user.match(/作业步骤：\s*\n([\s\S]*?)(?:\n\n|$)/) || [])[1] || '';
      const parsed = stepBlock
        .split('\n')
        .map((s) => s.replace(/^\s*\d+[\.、]\s*/, '').trim())
        .filter(Boolean);
      const steps = parsed.length ? parsed : [`${rule.cat}作业`];
      const riskLevel = (lv: string) => lv === '重大事故' ? '重大' : lv === '较大事故' ? '高' : lv === '一般事故' ? '中' : '低';
      const ruleByKw = [
        { kw: ['动火', '焊接', '明火', '火花', '易燃', '火灾', '爆炸'], hazards: ['火花引燃可燃物导致火灾', '动火高温灼伤作业人员'], controls: ['办理动火证并清理周边易燃物', '配备灭火器并设专人监火'] },
        { kw: ['高处', '坠落', '脚手架', '临边', '登高', '攀爬'], hazards: ['高处失稳坠落', '高处工具物件打击'], controls: ['高挂低用全身式安全带', '设置生命线/安全网'] },
        { kw: ['触电', '用电', '电气', '配电', '临时用电', '电线', '漏电', '断电', '验电', '接线'], hazards: ['残余电压或误送电致触电', '电缆破损漏电致触电'], controls: ['验电笔逐相验电确认无电压', '挂"禁止合闸"警示牌'] },
        { kw: ['起重', '吊装', '钢丝绳', '吊索'], hazards: ['吊物坠落砸伤人员', '起重设备失稳倾覆'], controls: ['检查吊具并试吊', '设置警戒区专人旁站'] },
        { kw: ['检修', '拆装', '更换', '拆卸', '装配'], hazards: ['零部件脱落砸伤手脚', '工具滑脱致误伤'], controls: ['断电断气后挂牌并双人配合', '穿戴防砸鞋与防护手套'] },
        { kw: ['焊接', '焊机'], hazards: ['弧光灼伤眼睛与皮肤', '焊烟尘致呼吸系统损伤'], controls: ['使用焊接面罩与防护服', '佩戴 N95 口罩并通风'] },
        { kw: ['喷涂', '油漆', '涂料'], hazards: ['可燃气体聚集遇火花爆炸', '有机溶剂中毒'], controls: ['强制通风并检测可燃气体', '佩戴防毒面具或送风式呼吸器'] },
        { kw: ['开挖', '基坑', '沟槽'], hazards: ['土方坍塌掩埋人员', '地下管线破坏'], controls: ['放坡或支护并专人监护', '人工探明地下管线'] },
      ];
      const out = steps.map((step) => {
        const matches = ruleByKw.filter((r) => r.kw.some((k) => step.includes(k)));
        if (matches.length > 0) {
          // 取第一个匹配作为危害+措施（避免一条步骤出现多个差异化的危害，过于碎片）
          const m = matches[0];
          return {
            step,
            hazard: m.hazards[0],
            risk: '高',
            control: m.controls[0],
          };
        }
        // 兜底：按步骤格式生成具体危害，避免模板话术
        return {
          step,
          hazard: `「${step}」作业前未确认安全措施，易导致人身伤害或设备异常`,
          risk: riskLevel(rule.level),
          control: rule.measures.split('；')[0] || rule.measures,
        };
      });
      return JSON.stringify(out, null, 2);
    }

    // 默认：隐患 JSON 分析
    const firstLine = (user.match(/隐患描述：([^\n]*)/) || [])[1]?.trim() || '现场存在安全隐患';
    return JSON.stringify(
      {
        aiDescription: firstLine.slice(0, 80),
        aiCategory: rule.cat,
        aiRiskLevel: rule.level,
        aiRegulation: rule.reg,
        aiSuggestion: rule.sug,
        aiRootCause: '直接原因多为安全防护/管理缺失；深层原因为安全培训与交底不到位、制度执行与监督缺位。',
        ai5Why:
          '1) 为何发生？直接原因：' + firstLine.slice(0, 40) + '；\n' +
          '2) 为何出现该直接原因？相应的防护或隔离措施缺失；\n' +
          '3) 为何防护会缺失？作业前风险辨识与交底不到位；\n' +
          '4) 为何交底不到位？安全责任制与班前会未有效执行；\n' +
          '5) 根本原因：双重预防机制未真正落地，隐患排查治理流于形式。',
        aiControlMeasures: rule.measures,
      },
      null,
      2,
    );
  }

  private matchRule(t: string): {
    cat: string;
    level: string;
    reg: string;
    sug: string;
    sugHint: string;
    measures: string;
  } {
    const rules: { kw: string[]; out: any }[] = [
      {
        kw: ['动火', '焊接', '明火', '火花', '易燃', '火灾', '爆炸'],
        out: {
          cat: '动火/火灾爆炸',
          level: '重大',
          reg: 'GB 30871-2022《危险化学品企业危险作业安全规范》；GB 50016《建筑设计防火规范》',
          sug: '办理动火作业票，清除周边易燃物，配备灭火器，设专人监护，作业前检测可燃气体浓度。',
          sugHint: '易燃物与火源共存、可燃气体聚集',
          measures: '动火前可燃气体检测；配备灭火器材；设专人监护；与可燃物保持安全距离；动火结束余火复查',
        },
      },
      {
        kw: ['高处', '坠落', '脚手架', '临边', '登高', '攀爬'],
        out: {
          cat: '高处坠落',
          level: '较大',
          reg: 'GB 30871-2022；GB/T 3608《高处作业分级》',
          sug: '系挂安全带（高挂低用），脚手架验收合格挂牌，设置防坠落设施与警戒区。',
          sugHint: '高处失稳、坠落、物件打击',
          measures: '佩戴全身式安全带并高挂低用；脚手架验收挂牌；设置安全网/生命线；临边洞口防护',
        },
      },
      {
        kw: ['触电', '用电', '电气', '配电', '临时用电', '电线', '漏电'],
        out: {
          cat: '触电',
          level: '较大',
          reg: 'GB 50194《建设工程施工现场供用电安全规范》；JGJ 46',
          sug: '执行临时用电审批，采用 TN-S 系统，逐级漏电保护，电工持证，电缆架空或穿管保护。',
          sugHint: '设备漏电、电缆破损、违章接线',
          measures: '采用 TN-S 接零保护；逐级漏电保护；电工持证作业；电缆架空或穿管；一机一闸一漏一箱',
        },
      },
      {
        kw: ['受限', '密闭', '罐', '窨', '池', '窖', '地沟', '有限空间'],
        out: {
          cat: '中毒窒息',
          level: '重大',
          reg: 'GB 30871-2022 受限空间作业；GBZ 2.1《工作场所有害因素职业接触限值》',
          sug: '严格“先通风、再检测、后作业”，连续监测，强制通风，佩戴呼吸防护，设监护与救援预案。',
          sugHint: '有毒有害气体聚集、缺氧',
          measures: '先通风后检测；作业中连续气体监测；强制通风；佩戴正压式空气呼吸器；设专人监护与救援',
        },
      },
      {
        kw: ['起重', '吊装', '吊车', '钢丝绳', '吊索', '行车'],
        out: {
          cat: '起重伤害',
          level: '较大',
          reg: 'GB 6067《起重机械安全规程》；GB/T 5972',
          sug: '吊具索具检查合格，编制吊装方案，设警戒区，起重指挥持证，严禁人员进入吊物下方。',
          sugHint: '吊物坠落、挤压、碰撞',
          measures: '吊索具检查合格；划定警戒区；起重指挥持证；严禁歪拉斜吊与人员位于吊物下',
        },
      },
      {
        kw: ['机械', '旋转', '挤压', '卷入', '齿轮', '皮带', '防护罩'],
        out: {
          cat: '机械伤害',
          level: '较大',
          reg: 'GB 5083《生产设备安全卫生设计总则》',
          sug: '转动部位设置防护罩与联锁，执行上锁挂牌（LOTO），严禁戴手套操作旋转部位。',
          sugHint: '转动/传动部位绞碾、挤压',
          measures: '转动部位装设牢固防护罩；实行 LOTO 上锁挂牌；急停装置有效；严禁戴手套操作旋转设备',
        },
      },
      {
        kw: ['化学品', '中毒', '腐蚀', '泄漏', '有毒', '危化', '酸碱'],
        out: {
          cat: '中毒/化学灼伤',
          level: '重大',
          reg: 'GB 15603《常用化学危险品贮存通则》；GBZ 2.1',
          sug: '加强通风，佩戴防毒面具与防护服，设置防泄漏收容与应急冲洗设施，限制接触时间。',
          sugHint: '有毒蒸气、腐蚀性物质接触',
          measures: '局部通风排毒；佩戴防毒面具/防护服；设置防泄漏围堰；配置应急冲洗设施',
        },
      },
      {
        kw: ['噪声', '粉尘', '职业健康', '尘肺', '有毒有害'],
        out: {
          cat: '职业危害（粉尘/噪声）',
          level: '一般',
          reg: 'GBZ 2.2《工作场所有害因素职业接触限值》',
          sug: '佩戴防尘防毒口罩/耳塞，开展岗前在岗职业健康体检，工程降尘降噪。',
          sugHint: '长期粉尘/噪声接触',
          measures: '佩戴防颗粒物口罩/耳塞；定期职业健康体检；采取湿式作业与隔声降噪',
        },
      },
    ];
    for (const r of rules) {
      if (r.kw.some((k) => t.includes(k.toLowerCase()))) return r.out;
    }
    return {
      cat: '其他安全隐患',
      level: '一般',
      reg: '《安全生产法》第二十一条、第四十一条',
      sug: '按"五定"原则（定人、定时、定责、定标准、定措施）落实整改，实现闭环管理。',
      // 兜底规则：sugHint 不再用模板话术，改通用短语；offline jsa 模式会用"step + 风险 + 措施"组合避免重复
      sugHint: '作业人员操作不当或现场防护不到位',
      measures: '指定作业负责人旁站监护；作业前逐项核对安全措施；完成后逐项验收',
    };
  }
}
