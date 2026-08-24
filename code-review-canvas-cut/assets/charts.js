(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var ok = style.getPropertyValue('--ok').trim();

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  }

  var el = document.getElementById('chart-status');
  if (!el || !window.echarts) return;

  var chart = echarts.init(el, null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true },
    grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'category',
      data: ['完整落地', '落地但有执行层缺口'],
      inverse: true,
      axisLabel: { color: ink, fontSize: 13 },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      barWidth: 36,
      data: [
        { value: 8, itemStyle: { color: ok } },
        { value: 5, itemStyle: { color: warn } }
      ],
      label: { show: true, position: 'right', color: ink, fontWeight: 700, fontFamily: 'JetBrainsMono, monospace' }
    }]
  });

  window.addEventListener('resize', function () { chart.resize(); });
})();
