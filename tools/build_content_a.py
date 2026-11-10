#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性内容构建脚本（A 组扩容）：把新增句式组与模板注入 email/phrases.html、email/templates.html。

设计要点：
- 幂等：检测到 data-cat="inquiry" / <!-- 17 --> 已存在就跳过，可重复运行。
- 路径全部由 __file__ 推算，不接收命令行参数（中文路径经 argv 传递在 Windows 上会乱码）。
- 只做插入与计数更新，不改已有条目。
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHRASES = os.path.join(ROOT, 'email', 'phrases.html')
TEMPLATES = os.path.join(ROOT, 'email', 'templates.html')

# ---------------------------------------------------------------- 句式数据
# (分类 key, 中文标题, 英文副标题, [(id, 英文, 中文注释, tag class, tag 文案)])
PHRASE_GROUPS = [
    ("inquiry", "询盘与问询", "Inquiry", [
        ("inq1", "We are interested in your LED panel lights and would like your best quotation for 500 pcs.", "我们对你们的 LED 面板有兴趣，希望得到 500 只的最优报价。", "", "中性"),
        ("inq2", "Could you send your latest catalogue and price list for the models listed below?", "能否发一份最新目录和价目表，型号见下。", "", "中性"),
        ("inq3", "Please quote your lowest price CIF Hamburg for 1,000 pcs, including export packing.", "请报 1000 只 CIF 汉堡最低价，含出口包装。", "tag--formal", "偏正式"),
        ("inq4", "We are comparing three suppliers for this project and would need your offer by 20 March.", "这个项目我们在比较三家供应商，希望 3 月 20 日前拿到报价。—— 给对方一个真实的期限", "", "中性"),
        ("inq5", "Could you confirm whether you can supply the 4000K version in 500 pcs?", "能否确认 4000K 版本能否供 500 只？", "", "中性"),
        ("inq6", "Your company was recommended to us by … , and we would like to know more about your export range.", "贵司由……推荐给我们，想进一步了解你们的出口产品线。", "", "中性"),
        ("inq7", "What is your MOQ and lead time for a trial order?", "试单的起订量和交期分别是多少？—— 只问两个问题，客户好答", "", "中性"),
        ("inq8", "Could you send one sample of the 36W panel for evaluation? We will cover the courier cost.", "能否寄一只 36W 面板样品供评估？快递费我们承担。—— 主动承担运费，回复率高一截", "tag--friendly", "友好"),
        ("inq9", "We are a lighting distributor covering 40 retail stores in …, and we are looking for a second supplier.", "我们是覆盖……40 家零售门店的照明经销商，正在寻找第二家供应商。", "tag--formal", "偏正式"),
        ("inq10", "Could you produce to our own specification, and what would the tooling cost be?", "能否按我们的规格生产？开模费多少？", "", "中性"),
        ("inq11", "Is this item available in a dimmable version? If so, please quote it separately.", "这款有可调光版本吗？如有请单独报价。", "", "中性"),
        ("inq12", "We would appreciate your quotation in USD, FOB Ningbo, broken down by model.", "希望按型号分项报价，美元、宁波离岸价。—— 分项报价能省掉后面三轮追问", "tag--formal", "偏正式"),
    ]),
    ("quote", "报价与条款", "Quotation", [
        ("qt1", "Our quotation is attached; prices are FOB Ningbo and valid until 25 March.", "报价见附件，宁波离岸价，有效期至 3 月 25 日。", "", "中性"),
        ("qt2", "The price for 500 pcs is USD 12.40/pc; from 1,000 pcs we can offer USD 11.90.", "500 只 12.40 美元，1000 只起可报 11.90 美元。—— 用数量差制造升级动机", "", "中性"),
        ("qt3", "Please note that the price excludes the copper surcharge, currently 3%.", "请注意价格不含铜价附加费，目前为 3%。", "tag--formal", "偏正式"),
        ("qt4", "This quotation is based on the specification in your RFQ dated 12 March.", "本报价基于贵方 3 月 12 日询价单中的规格。—— 写清依据，避免后续改规格扯价", "tag--formal", "偏正式"),
        ("qt5", "We can hold this price for 30 days from the date of this email.", "本价格自本邮件之日起保留 30 天。", "", "中性"),
        ("qt6", "For orders below MOQ, a small-quantity surcharge of USD 0.30/pc applies.", "低于起订量的订单加收 0.30 美元/只的小批量费用。", "", "中性"),
        ("qt7", "The price includes export packing but excludes freight and insurance.", "价格含出口包装，不含运费与保险。", "tag--formal", "偏正式"),
        ("qt8", "If you can commit to an annual volume, we can quote a frame price instead of a per-order price.", "如果能承诺年采购量，我们可以报框架价而不是单单价。", "", "中性"),
        ("qt9", "Our best price for 2,000 pcs is USD 11.40, subject to confirmation of the driver brand.", "2000 只最优价 11.40 美元，前提是驱动品牌确认。", "", "中性"),
        ("qt10", "We have revised the quotation — the previous version contained a typo in the unit price.", "报价已修订：上一版单价有笔误。—— 主动认错比等客户发现好", "", "中性"),
        ("qt11", "I've attached a cost breakdown by component so you can see where the price sits.", "附上按部件的成本拆解，可以看到价格构成。", "", "中性"),
        ("qt12", "To keep this price, we would need your confirmation before the raw material adjustment on 1 April.", "要保住这个价格，需在 4 月 1 日原材料调价前确认。—— 期限真实，才叫期限", "", "中性"),
    ]),
    ("sample", "样品与打样", "Samples", [
        ("sp1", "The samples were dispatched today by DHL; the tracking number is {{TrackingNo}}.", "样品今天已由 DHL 寄出，单号是……。", "", "中性"),
        ("sp2", "The sample charge is USD 30, refundable against your first order.", "样品费 30 美元，首单可抵扣。", "", "中性"),
        ("sp3", "Could you confirm the delivery address and a contact number for the courier?", "能否确认收件地址和快递联系人电话？—— 地址不清是样品丢件的头号原因", "", "中性"),
        ("sp4", "The sample is identical to mass production except for the printed label.", "除印刷标签外，样品与大货完全一致。", "", "中性"),
        ("sp5", "We can send a pre-production sample for your approval before we run the full batch.", "大货前可以先寄产前样供确认。", "", "中性"),
        ("sp6", "Please note the sample lead time is 7 working days from receipt of your artwork.", "样品交期为收到包装稿后 7 个工作日。", "tag--formal", "偏正式"),
        ("sp7", "If the sample is acceptable, please sign and return the approval sheet.", "样品如果没问题，请签字回传确认单。", "tag--formal", "偏正式"),
        ("sp8", "Courier cost is on your side for now; we will deduct it from the first invoice.", "快递费先由贵方承担，首单发票里抵扣。", "", "中性"),
        ("sp9", "The sample you received came from our previous batch — please disregard the colour difference.", "您收到的样品是上一批的，色差请忽略。", "tag--friendly", "委婉"),
        ("sp10", "We keep your approved sample on file and check every production run against it.", "我们留存您确认的样品，每批大货都对照它检验。", "", "中性"),
    ]),
    ("exhibition", "展会", "Trade fairs", [
        ("ex1", "We will be exhibiting at {{Exhibition}}, Booth {{BoothNo}}, from 15 to 19 April.", "我们将参加……展会，展位……，4 月 15–19 日。", "", "中性"),
        ("ex2", "Would you be available for a 30-minute meeting at our booth on 16 April?", "4 月 16 日能否到我们展位聊 30 分钟？", "", "中性"),
        ("ex3", "Please find the hall map and our booth location attached.", "附上展馆图和我们的展位位置。", "", "中性"),
        ("ex4", "If you are not attending this year, I can send the new samples to your office instead.", "如果今年不来，我可以把新样品寄到您办公室。—— 给不去的人留一个入口", "tag--friendly", "友好"),
        ("ex5", "It was good to meet you at the fair — as promised, here is the quotation.", "展会上见到您很高兴，按约定附上报价。", "tag--friendly", "友好"),
        ("ex6", "Following our conversation at your booth, I am sending the specification you asked for.", "承接在您展位的交谈，附上您要的规格书。", "", "中性"),
        ("ex7", "Thank you for your time at the fair; I have noted the three points you raised.", "感谢展会上的时间，您提的三点我都记下了。—— 复述要点，证明你真的在听", "", "中性"),
        ("ex8", "We are booking meeting slots for the fair — let me know which day suits you best.", "我们正在排展会期间的会谈时段，请告知哪天方便。", "", "中性"),
        ("ex9", "Our booth will have the new 36W panel on display, the one we discussed last year.", "展位上会展示去年我们聊过的那款 36W 新面板。", "", "中性"),
        ("ex10", "I'll bring the certification files and a sample to the fair so you can review them on site.", "我会带认证文件和样品到展会，您可以现场看。", "", "中性"),
    ]),
    ("payment", "付款与结算", "Payment", [
        ("pm1", "Our standard terms are 30% T/T deposit, balance against copy of B/L.", "标准付款方式为 30% 电汇定金，余款见提单副本。", "tag--formal", "偏正式"),
        ("pm2", "We can accept L/C at sight for this order; please confirm the issuing bank.", "本单可接受即期信用证，请确认开证行。", "tag--formal", "偏正式"),
        ("pm3", "Could you arrange the deposit this week so we can hold the production slot?", "能否本周安排定金，以便保留生产排期？", "", "中性"),
        ("pm4", "The balance of {{Total}} is due before shipment; I'll send the invoice today.", "余款……美元需在出货前付清，发票今天发。", "", "中性"),
        ("pm5", "For the first order we would ask for 100% T/T in advance; from the second order we can move to 30/70.", "首单需 100% 预付，第二单起可改为 30/70。", "", "中性"),
        ("pm6", "Please note our bank charges are on our side; correspondent bank charges are on yours.", "我方承担我方银行费用，中间行费用由贵方承担。—— 这句不写，后面必然争一次", "tag--formal", "偏正式"),
        ("pm7", "Could you send the payment slip once the transfer is made? It helps us trace the funds.", "汇款后能否发一下水单？便于我们查账。", "tag--friendly", "友好"),
        ("pm8", "We have received your deposit — production starts tomorrow.", "定金已收到，明天开始生产。", "", "中性"),
        ("pm9", "If cash flow is tight this month, we can split the balance into two payments.", "如果这个月资金紧，余款可以分两次付。—— 给台阶，比催更有效", "tag--friendly", "友好"),
        ("pm10", "The L/C has two discrepancies — please amend the shipment date and allow partial shipment.", "信用证有两处不符点：请修改装运期、允许分批装运。", "tag--formal", "偏正式"),
    ]),
    ("shipping", "出货与物流", "Shipping", [
        ("sh1", "The goods were loaded on 8 April; the B/L will be released within three working days.", "货已于 4 月 8 日装船，提单三个工作日内放。", "", "中性"),
        ("sh2", "Please find the draft B/L for your confirmation before we release the original.", "附上提单草稿，请确认后我们再放正本。", "tag--formal", "偏正式"),
        ("sh3", "The vessel is scheduled to arrive in Hamburg on 12 April; I'll track it for you.", "预计 4 月 12 日到汉堡，我会帮您跟踪。", "", "中性"),
        ("sh4", "We have booked space on the 18 April sailing; the cut-off is 15 April.", "已订 4 月 18 日船期，截关日 4 月 15 日。", "", "中性"),
        ("sh5", "Could you confirm the shipping marks you want printed on the cartons?", "请确认纸箱上要印的唛头。", "", "中性"),
        ("sh6", "Total 12 cartons, 1.8 CBM, 210 kg gross — details are in the packing list attached.", "共 12 箱，1.8 立方，毛重 210 公斤，详见附件装箱单。", "", "中性"),
        ("sh7", "The goods are ready for collection; please advise your forwarder.", "货已备好可提，请通知您的货代。", "", "中性"),
        ("sh8", "The carrier has applied a peak season surcharge of USD 300 per container.", "船公司加收旺季附加费 300 美元/柜。", "tag--formal", "偏正式"),
        ("sh9", "The shipment was rolled to the next vessel; the new ETD is 22 April.", "货物被延至下一班船，新预计开船日 4 月 22 日。—— roll 是行业词，客户一听就懂", "", "中性"),
        ("sh10", "I'll send you the full set of documents — invoice, packing list, B/L and C/O — by courier.", "全套单据（发票、装箱单、提单、产地证）会快递给您。", "", "中性"),
    ]),
    ("quality", "品质与验货", "Quality", [
        ("qc1", "The pre-shipment inspection was completed on 6 March; the report is attached.", "出货前检验已于 3 月 6 日完成，报告见附件。", "", "中性"),
        ("qc2", "Two units out of 500 failed the aging test — we have already replaced them.", "500 只里有 2 只老化测试未通过，已更换。", "", "中性"),
        ("qc3", "Could you send photos of the defect so our engineers can identify the cause?", "能否发几张不良照片？我们工程师判断一下原因。", "", "中性"),
        ("qc4", "The failure rate you report is higher than our 0.5% allowance; we would like to investigate.", "您反馈的不良率高于我们 0.5% 的允收水平，我们想查一下。", "", "中性"),
        ("qc5", "We can arrange a third-party inspection before shipment, at your cost.", "出货前可以安排第三方验货，费用由贵方承担。", "", "中性"),
        ("qc6", "All units are 100% tested for 4 hours before packing.", "所有产品包装前 100% 老化 4 小时。", "", "中性"),
        ("qc7", "The colour difference you mentioned is within the 3-step tolerance agreed in the specification.", "您提到的色差在规格书约定的 3 阶公差内。", "tag--formal", "偏正式"),
        ("qc8", "Please return the defective units with the next shipment so we can analyse them.", "不良品请随下批货退回，我们做分析。", "", "中性"),
        ("qc9", "We have added an extra QC checkpoint after your feedback.", "根据您的反馈，我们增加了一道质检工序。", "", "中性"),
        ("qc10", "If the goods do not meet the agreed specification, we will replace them at our cost.", "如产品不符合约定规格，我们免费更换。", "", "中性"),
    ]),
    ("delay", "延期与坏消息", "Delays", [
        ("dl1", "I'm sorry to let you know that the shipment will be delayed by eight days.", "很抱歉，出货要延后八天。", "", "中性"),
        ("dl2", "The new ETD is 18 March; everything else in the order is unchanged.", "新开船日 3 月 18 日，订单其他内容不变。—— 这句能砍掉客户一半追问", "", "中性"),
        ("dl3", "The delay was caused by a component shortage; we have now secured an alternative supply.", "延误原因是缺料，现已落实替代供应。", "", "中性"),
        ("dl4", "We are doing everything we can to recover the schedule.", "我们在尽一切努力追回进度。", "tag--friendly", "委婉"),
        ("dl5", "To protect your line, we can air-freight 100 pcs at our cost.", "为不影响您的产线，我们可以空运 100 只，费用我方承担。", "", "中性"),
        ("dl6", "Please let us know if the new date creates a problem for your production plan.", "如果新日期影响您的生产计划，请告诉我们。", "", "中性"),
        ("dl7", "We expect to confirm the revised schedule with the carrier by Friday.", "预计周五前与船公司确认新船期。", "", "中性"),
        ("dl8", "I would rather tell you now than wait until the original ship date.", "与其等到原定船期再说，不如现在就告诉您。—— 把「坏消息」变成「早告知」", "tag--friendly", "委婉"),
        ("dl9", "The factory is running a second shift to make up the lost days.", "工厂已开二班，把耽误的天数补回来。", "", "中性"),
        ("dl10", "We have moved your order to the front of the queue after the delay.", "延误之后，我们把您的订单调到了队列最前。", "", "中性"),
    ]),
    ("meeting", "约会议与通话", "Calls & meetings", [
        ("mt1", "Would Thursday 21 March at 15:00 CET work for a 30-minute call?", "3 月 21 日周四中欧时间 15:00 通话 30 分钟，方便吗？—— 时区必须写清", "", "中性"),
        ("mt2", "I'll send a calendar invitation with the dial-in details.", "我会发日历邀请，附拨入方式。", "", "中性"),
        ("mt3", "Could we move our call to Friday? I have a factory visit on Thursday.", "通话能改到周五吗？周四我要去工厂。", "tag--friendly", "友好"),
        ("mt4", "Here is a short agenda for tomorrow's call: price, lead time, payment terms.", "明天通话的简短议程：价格、交期、付款方式。", "", "中性"),
        ("mt5", "Sorry, I can't hear you well — could you repeat the last part?", "抱歉听不太清，最后一段能再说一遍吗？", "", "中性"),
        ("mt6", "Let me summarise what we agreed on the call just now.", "我把刚才电话里达成的内容小结一下。—— 会后复述，防扯皮", "", "中性"),
        ("mt7", "I'll send the minutes and the open points within the hour.", "一小时内发会议纪要和未决事项。", "", "中性"),
        ("mt8", "If the time doesn't suit you, please suggest two slots that work.", "如果时间不合适，请给我两个可行的时段。", "tag--friendly", "友好"),
        ("mt9", "I'm on WeChat and WhatsApp if a quick message is easier than an email.", "急事可以微信或 WhatsApp 找我，比邮件快。", "tag--friendly", "友好"),
        ("mt10", "Could you confirm who else from your team will join the call?", "能否确认贵方还有谁参加？", "", "中性"),
    ]),
    ("thanks", "致谢与关系", "Thanks", [
        ("tk1", "Thanks for the quick reply — that answers both questions.", "谢谢这么快回复，两个问题都清楚了。", "tag--friendly", "友好"),
        ("tk2", "Thank you for the order; we'll take good care of it.", "谢谢下单，我们会盯好这一单。", "tag--friendly", "友好"),
        ("tk3", "Thanks for your patience while we sorted this out.", "谢谢您在这件事上的耐心。", "tag--friendly", "友好"),
        ("tk4", "I appreciate your flexibility on the payment date.", "谢谢您在付款日期上的通融。", "tag--friendly", "友好"),
        ("tk5", "Thank you for the detailed feedback — it is useful for our next production run.", "谢谢这么详细的反馈，对下一批生产很有用。", "tag--friendly", "友好"),
        ("tk6", "Thanks for introducing me to your colleague in procurement.", "谢谢把我介绍给采购部的同事。", "tag--friendly", "友好"),
        ("tk7", "It has been a pleasure working with you on this project.", "这个项目合作很愉快。", "tag--friendly", "友好"),
        ("tk8", "Thank you for the referral — I have written to them and mentioned your name.", "谢谢推荐，我已联系他们并提到您。", "tag--friendly", "友好"),
        ("tk9", "Many thanks for the hospitality during my visit to your factory.", "谢谢您在我参观工厂期间的接待。", "tag--friendly", "友好"),
        ("tk10", "Thanks again for the smooth cooperation this year; I look forward to the next one.", "谢谢今年的顺利合作，期待下一单。", "tag--friendly", "友好"),
    ]),
]

CHIP_LABELS = [
    ("inquiry", "询盘"),
    ("quote", "报价"),
    ("sample", "样品"),
    ("exhibition", "展会"),
    ("payment", "付款"),
    ("shipping", "出货"),
    ("quality", "品质"),
    ("delay", "延期"),
    ("meeting", "会议"),
    ("thanks", "致谢"),
]


def phrase_html(cat, zh, en, items):
    out = ['      <div class="phrase-group" data-cat="%s">' % cat,
           '        <h3>%s · %s</h3>' % (zh, en)]
    for pid, e, c, cls, tag in items:
        cls_attr = (' %s' % cls) if cls else ''
        out.append('        <div class="phrase" data-id="%s">' % pid)
        out.append('          <div><div class="ph-en">%s</div><div class="ph-cn">%s</div></div>' % (e, c))
        out.append('          <div class="ph-side"><span class="tag%s">%s</span>'
                   '<button class="icon-btn fav-btn" type="button" aria-pressed="false" '
                   'title="收藏这句">★</button></div>' % (cls_attr, tag))
        out.append('        </div>')
    out.append('      </div>')
    out.append('')
    return '\n'.join(out)


def build_phrases():
    src = io.open(PHRASES, encoding='utf-8').read()
    if 'data-cat="inquiry"' in src:
        print('phrases: 已含新分组，跳过')
        return len(re.findall(r'class="phrase" data-id=', src))

    # 1) 新分组插到 #phrase-list 结束前
    block = '\n' + '\n'.join(phrase_html(*g) for g in PHRASE_GROUPS)
    anchor = '\n    <p class="empty-state" id="phrase-empty" hidden>'
    assert anchor in src, '找不到 empty-state 锚点'
    src = src.replace(anchor, block + anchor, 1)

    # 2) 分类 chip
    chips = ''.join(
        '\n      <button class="chip" type="button" data-cat="%s">%s</button>' % (k, label)
        for k, label in CHIP_LABELS)
    chip_anchor = '\n      <button class="chip" type="button" id="only-fav"'
    assert chip_anchor in src, '找不到 chip 锚点'
    src = src.replace(chip_anchor, chips + chip_anchor, 1)

    # 3) 标题计数
    total = len(re.findall(r'class="phrase" data-id=', src))
    src = re.sub(r'<h1 style="font-size:clamp\(26px,3\.4vw,38px\)">\d+ 条，按「你要干什么」分类</h1>',
                 '<h1 style="font-size:clamp(26px,3.4vw,38px)">%d 条，按「你要干什么」分类</h1>' % total,
                 src, count=1)
    io.open(PHRASES, 'w', encoding='utf-8', newline='\n').write(src)
    print('phrases: 写入完成，共 %d 条' % total)
    return total


# ---------------------------------------------------------------- 模板数据
# (编号, 标题, 副标题, tag class, tag 文案, 正文, 注释)
TEMPLATES_DATA = [
    (17, "客户不认涨价", "异议处理 · 不降价也不失客户", "", "中性",
     """Subject: Re: Price increase — three options for {{OrderNo}}

Dear {{Customer}},

Thank you for being direct about the gap. Let me be equally direct.

The USD 0.60/pc increase is the copper and driver cost we absorbed for the last two runs. If we hold {{Price}}, we would be selling below cost on this specification, so I can't offer that.

What I can offer is three ways to keep your landed cost flat:
· Keep the current price and move to a 2-year warranty instead of 3
· Keep the 3-year warranty and drop the dimmable function
· Keep everything and take 2,000 pcs, which brings the unit cost to {{Price}} with no increase

Which of the three gets closest to what you need? I can send the revised PI the same day.""",
     "客户说「别家便宜 8%」时，最差的回应是「我们的质量更好」——那是观点。这里给的是三条能算账的路径：改配置、改数量、改服务。三条都不含降价，但每一条都让客户觉得自己有选择。"),

    (18, "样品寄出通知", "含单号 · 到货后跟进", "tag--friendly", "友好",
     """Subject: Sample sent — {{Product}}, DHL {{TrackingNo}}

Dear {{Customer}},

The sample left our factory this morning by DHL. Tracking number: {{TrackingNo}}; expected delivery in 4 to 5 working days.

Two notes so you can evaluate it properly:
· The unit is from our standard production run, not a hand-made sample — what you test is what you get.
· The label is blank on purpose; your artwork will be printed from the confirmed file.

When it arrives, the two things worth checking are the colour temperature at 4000K and the driver brand on the label. If either is not what you expected, tell me and I'll send a replacement before you spend more time on it.

I'll follow up on {{ValidDate}} in case the parcel sits in customs.""",
     "样品邮件最容易犯的错是只给单号、不说「收到后该看什么」。最后一句把跟进时间写死，也让客户知道你会来问——比「please feel free to contact me」有用。"),

    (19, "展会邀约（展前）", "展前 3-4 周 · 预约时段", "", "中性",
     """Subject: {{Exhibition}} — booth {{BoothNo}}, and a 30-minute slot for you

Dear {{Customer}},

We will be at {{Exhibition}} from 15 to 19 April, booth {{BoothNo}}, hall 12.2.

Rather than hope you walk past, may I book a slot? I can hold 30 minutes on 16 or 17 April, whichever suits you. On the table: the new {{Product}} range and the cost-down version of your current item — I think the second one is what you'll want to see.

If you're not attending this year, tell me and I'll courier the samples to your office instead, so you're not out of the loop.

Booth map attached.""",
     "展前邀约的关键是「给对方一个好理由来」，不是「欢迎光临」。第二段点名「你可能想看的那个降本版本」，比罗列全系列有效。最后给不去的人一条替代路径，这一条常常带来真正的回信。"),

    (20, "展后跟进", "展会结束后 3 天内 · 名片变现", "", "中性",
     """Subject: Following up — our talk at {{Exhibition}} about {{Product}}

Dear {{Customer}},

We met at our booth on 16 April — you were looking at the 36W panel and asked about the price at 1,000 pcs.

Here is the answer in one line: {{Price}}/pc, {{Incoterm}}, {{LeadTime}} after deposit. Quotation with the full specification is attached.

You also mentioned that your current supplier's lead time has been unreliable. If that's still the issue, we can hold stock for you at our warehouse and ship within 10 days of your call-off — that's a different arrangement from a normal order, but it's one we use with two customers in your market.

Shall I put together a stock-holding proposal, or would you rather start with a normal trial order first?""",
     "展后跟进的价值全在「复述」：他说过什么、问过什么价、抱怨过什么。第三段把「抱怨」变成提案，是名片变订单的那一步。结尾两个选项，客户答哪个都能往下走。"),

    (21, "验厂接待确认", "客户来访 · 把行程钉死", "tag--formal", "偏正式",
     """Subject: Factory visit on {{ValidDate}} — schedule and what to bring

Dear {{Customer}},

Thank you for confirming the visit on {{ValidDate}}. Here is the plan so your day is not spent waiting for us.

09:30 pick-up from your hotel
10:00 factory tour: SMT line, assembly, aging room, QC station
11:30 document review: certifications, incoming inspection records, last three shipment reports
12:30 lunch, then a short session on your specification questions

For the documents you asked about: we will have CE, RoHS and the last 12 months of incoming inspection records ready. If your auditor needs anything else, send the list by {{ValidDate}} and we will prepare it.

One request: please confirm how many people are coming, so we can arrange the meeting room and transport.""",
     "验厂邮件的作用是「降低对方的不确定性」：他到现场最怕的是乱、等、找不到人。把时间表、要看的东西、需要他确认的事写清，专业感不是靠形容词堆出来的。"),

    (22, "付款方式协商", "客户要 O/A，我方给替代", "", "中性",
     """Subject: Payment terms for {{OrderNo}} — a structure that works for both sides

Dear {{Customer}},

I understand you would prefer open account terms. For a first order we can't carry that risk, but I don't want to leave you with only one option.

Three structures we can work with:
· 30% T/T deposit, 70% against copy of B/L — our standard
· L/C at sight — workable if the issuing bank is acceptable to us
· 20% deposit and the balance in two instalments 30 and 60 days after B/L — this needs credit insurance, which we can arrange

If the third one is close to what you need, I'll send the credit insurance requirements today. After two or three clean orders, moving to O/A is realistic.

Which structure should I put in the PI?""",
     "拒绝付款条件时，最有效的是「给一个更接近他的替代方案 + 说清升级路径」。最后那句「两三单干净记录之后 O/A 是现实的」，比任何担保话术都更能留住客户。"),

    (23, "订单变更与取消", "改数量 / 改规格 / 取消", "", "中性",
     """Subject: Change to {{OrderNo}} — what is still possible, and the cost

Dear {{Customer}},

I've checked your request against where the order stands today.

Changing the quantity from {{Qty}} to 1,200 pcs: possible, unit price stays {{Price}}, but the ship date moves from {{ValidDate}} to 10 days later, because the driver batch is already allocated.

Changing the housing colour: not possible for this run — the parts are anodised and 800 sets are already finished.

Cancelling the order entirely: we would need to charge for the finished units and the customised packaging, which comes to {{Total}}.

Tell me which of these you want and I'll confirm in writing today. If none of them fit, call me and we'll find a way to phase it.""",
     "变更邮件的核心是「分清还能改和不能改」，并且给每个选项标上代价。最忌「let me check with the factory and get back to you」——这句话让客户失去对交期的信任。"),

    (24, "年度返单与框架", "年末谈下一年 · 用量换条件", "", "中性",
     """Subject: 2027 planning — {{Product}}, annual volume and price protection

Dear {{Customer}},

We are closing our 2027 production plan this month, and I would like to put {{Company}} into it properly rather than quote you order by order.

If you can indicate an annual volume, even roughly, here is what we can commit to:
· A fixed price for the year, reviewed only if copper moves more than 8%
· A reserved production slot each quarter, so your lead time drops from {{LeadTime}} to 15 days
· Your specification and packaging files kept on file, so re-orders need only a PO number

Last year you took four orders totalling about 3,000 pcs. If 2027 looks similar or larger, the fixed-price arrangement is worth 20 minutes of your time.

Shall we do a short call in the first week of December?""",
     "年度返单不是「再下一单」，是「把零散订单变成一个计划」。三个承诺都要具体到可执行（价格、排期、文件），最后用一个具体数字回顾去年——证明你一直在记他的量。"),

    (25, "质量投诉首封回复", "客户说有不良 · 还没提索赔", "", "中性",
     """Subject: Re: Quality issue — 12 units, batch 2603-A

Dear {{Customer}},

Thank you for the photos and the batch number — that was enough for us to trace the run.

What we have found so far: batch 2603-A used a driver from a different supplier than the previous run, and 12 units showing the same symptom points to that batch rather than to handling.

What we are doing:
· Sending 20 replacement units by air this week, at our cost
· Holding the remaining stock of that batch and re-testing it before any further shipment
· Asking the driver supplier for their 8D report, which I will forward to you

What I need from you: please keep the 12 defective units for now. If they can come back with your next shipment, we can complete the analysis instead of guessing.

I'm sorry this reached you. I'll update you on Friday even if there is nothing new.""",
     "首封回复的目的不是定责，是「让对方相信你在查」。三条「正在做的事」必须都是可验证的动作；最后一句「周五无论有没有进展都会同步」，是这类邮件里最值钱的一句。"),

    (26, "运费与汇率调整", "不涨价，收附加费", "tag--formal", "偏正式",
     """Subject: Freight surcharge from 1 April — {{OrderNo}} not affected

Dear {{Customer}},

Two cost lines have moved and I want to tell you before they appear on an invoice.

Freight: the carrier has applied a peak season surcharge of USD 300 per 40ft container from 1 April. On a 1,000 pcs order that is about USD 0.30/pc at current loading.

Exchange rate: the USD has moved 2.1% against RMB since our last quotation. We are not repricing existing quotations.

So: all orders confirmed before 31 March ship at the current all-in price. From 1 April, quotations will show freight as a separate line rather than built into the unit price — that way you can see exactly what changed, and you can also nominate your own forwarder if you prefer.

Your current order {{OrderNo}} is confirmed at the old price.""",
     "不涨价但收附加费时，「把运费单列」比「悄悄加进单价」好得多：客户能看懂、能比价、也能自己指定货代。最后一句先保住在手订单，避免客户以为你在追涨。"),
]

NEW_VARS = [
    ("Exhibition", "展会名", "Canton Fair"),
    ("BoothNo", "展位号", "12.2 C18"),
    ("TrackingNo", "快递单号", "DHL 1234567890"),
]


def template_html(num, title, sub, cls, tag, body, note):
    cls_attr = (' %s' % cls) if cls else ''
    return '''    <!-- {num:02d} -->
    <div class="tpl" data-template>
      <div class="tpl-top">
        <h3>{num:02d} {title}<span>{sub}</span></h3>
        <span class="tag{cls}">{tag}</span>
        <button class="btn btn--ghost btn--sm" type="button" data-copy="">复制</button>
      </div>
      <pre>{body}</pre>
      <p class="mail-note">{note}</p>
    </div>
'''.format(num=num, title=title, sub=sub, cls=cls_attr, tag=tag, body=body, note=note)


def build_templates():
    src = io.open(TEMPLATES, encoding='utf-8').read()
    if '<!-- 17 -->' in src:
        print('templates: 已含新模板，跳过')
        return 16

    block = ''.join(template_html(*t) for t in TEMPLATES_DATA)

    anchor = '    <div class="callout callout--tip" style="margin-top:24px">'
    assert anchor in src, '找不到 callout 锚点'
    src = src.replace(anchor, block + '\n' + anchor, 1)

    # 变量输入框
    var_html = ''.join(
        '\n      <div class="tf"><label for="v-%s">%s</label>'
        '<input id="v-%s" data-var="%s" placeholder="%s" /></div>'
        % (k.lower(), label, k.lower(), k, ph) for k, label, ph in NEW_VARS)
    var_anchor = '\n      <button class="btn btn--ghost btn--sm" type="button" id="tpl-reset"'
    assert var_anchor in src, '找不到 reset 按钮锚点'
    src = src.replace(var_anchor, var_html + var_anchor, 1)

    total = len(re.findall(r'<div class="tpl" data-template>', src))
    src = src.replace('<h1 style="font-size:clamp(26px,3.4vw,38px)">16 封，覆盖外贸全流程</h1>',
                      '<h1 style="font-size:clamp(26px,3.4vw,38px)">%d 封，覆盖外贸全流程</h1>' % total)
    src = src.replace('下面 16 封邮件里的占位符会同时替换', '下面 %d 封邮件里的占位符会同时替换' % total)
    src = re.sub(r'content="16 封覆盖外贸全流程的英文邮件模板：([^"]*)"',
                 r'content="%d 封覆盖外贸全流程的英文邮件模板：\1"' % total, src, count=1)
    io.open(TEMPLATES, 'w', encoding='utf-8', newline='\n').write(src)
    print('templates: 写入完成，共 %d 封' % total)
    return total


if __name__ == '__main__':
    n1 = build_phrases()
    n2 = build_templates()
    print('--- 结果：句式 %d 条，模板 %d 封 ---' % (n1, n2))
