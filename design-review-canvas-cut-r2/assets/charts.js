(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var ok = style.getPropertyValue('--ok').trim();

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  }

  var el = document.getElementById('chart-progress');
  if (!el || !window.echarts) return;

  var categories = ['已解决（含按决策保留）', '部分解决', '未同步 / 声称未落地', '待最终拍板', '有意暂缓', '已归档待办', '本轮新发现'];
  var values = [17, 3, 3, 1, 1, 6, 5];
  var colors = [ok, warn, accent2, accent2, muted, muted, accent];

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
      data: categories,
      inverse: true,
      axisLabel: { color: ink },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      barWidth: 24,
      data: values.map(function (v, i) { return { value: v, itemStyle: { color: colors[i] } }; }),
      label: { show: true, position: 'right', color: ink, fontWeight: 700, fontFamily: 'JetBrainsMono, monospace' }
    }]
  });

  window.addEventListener('resize', function () { chart.resize(); });
})();
