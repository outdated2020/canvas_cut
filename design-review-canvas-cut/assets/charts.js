(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var warn = style.getPropertyValue('--warn').trim();

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  }

  var el = document.getElementById('chart-issues');
  if (!el || !window.echarts) return;

  var categories = ['架构与执行模型', '画布引擎', '时间线 / 渲染 / 预览', 'Agent 与技能', '存储与数据', 'Provider 对接'];
  var high = [2, 2, 1, 0, 0, 0];
  var mid = [1, 2, 1, 3, 2, 1];
  var low = [2, 1, 4, 0, 2, 1];

  var chart = echarts.init(el, null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true
    },
    legend: {
      data: ['高危', '中危', '低危'],
      top: 0,
      textStyle: { color: muted }
    },
    grid: { left: 8, right: 30, top: 36, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true,
      axisLabel: { color: ink },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false }
    },
    series: [
      {
        name: '高危',
        type: 'bar',
        stack: 'total',
        barWidth: 22,
        itemStyle: { color: accent2 },
        label: { show: true, position: 'inside', color: bg2, fontWeight: 700, fontSize: 11 },
        data: high
      },
      {
        name: '中危',
        type: 'bar',
        stack: 'total',
        itemStyle: { color: warn },
        label: { show: true, position: 'inside', color: bg2, fontWeight: 700, fontSize: 11 },
        data: mid
      },
      {
        name: '低危',
        type: 'bar',
        stack: 'total',
        itemStyle: { color: muted },
        label: { show: true, position: 'inside', color: bg2, fontWeight: 700, fontSize: 11 },
        data: low
      }
    ]
  });

  window.addEventListener('resize', function () { chart.resize(); });
})();
