import { defineConfig } from 'dumi';

export default defineConfig({
  title: '疫情数据',
  favicon: './logo.png',
  logo: './logo.png',
  outputPath: 'output',
  base: '/covid-19',
  publicPath: '/covid-19/',
  // more config: https://d.umijs.org/config
  define: {
    'process.env.GH_PAGES': process.env.GH_PAGES,
  },
  styles: [
    `.__dumi-default-layout { padding: 24px 64px !important; }
    .__dumi-default-menu { display: none !important; }
    .__dumi-default-navbar { display: none !important; }
    .__dumi-default-layout-footer-meta { display: none !important; }
    @media only screen and (max-width: 767px) {.__dumi-default-layout { margin-top: -42px; } }`,
  ],
  exportStatic: {
    dynamicRoot: true,
    htmlSuffix: true,
  },
  proxy: {
    '/news': {
      target: 'http://m.sh.bendibao.com',
      changeOrigin: true,
    },
    '/covid': {
      target: 'http://localhost:3300',
      changeOrigin: true,
    },
  },
});
