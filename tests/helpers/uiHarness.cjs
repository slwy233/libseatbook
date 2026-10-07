const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness, deferred } = require('./apiHarness.cjs');
const project = path.resolve(__dirname, '../..');
const dependency = name => require(require.resolve(name, { paths: [project] }));
const React = dependency('react');
const renderer = dependency('react-test-renderer');
const babel = dependency('@babel/core');
const commonjs = dependency('@babel/plugin-transform-modules-commonjs');
const jsx = dependency('@babel/plugin-transform-react-jsx');

function uiHarness(overrides = {}) {
  const core = createHarness();
  const storage = core.load('src/utils/storage.js');
  const alerts = [], resets = [], navigations = [];
  const navigation = { reset: state => resets.push(state), navigate: (...args) => navigations.push(args), goBack() {} };
  const api = {
    login: async () => ({ token: 'ui-token', userInfo: { name: '测试同学' } }),
    getCaptcha: async () => ({ captchaId: 'ui-captcha', captchaImage: 'ui-image' }),
    initSystemConfig: async () => ({}),
    getFreeSeats: async () => ({ status: true, data: { a: { id: 'seat-a', label: '1', status: 'FREE' }, b: { id: 'seat-b', label: '2', status: 'FREE' } } }),
    getStartTimes: async () => ({ status: true, data: [['480', '08:00']] }),
    getEndTimes: async () => ({ status: true, data: [['600', '10:00']] }),
    bookSeat: async () => ({ status: true }),
    findRoomDuration: async () => ({ status: true, data: { pageList: [{ id: 'room-a', name: '自习室A', seatFree: 10, seatTotal: 20 }], totalCount: 1 } }),
    getBuildingFloorDate: async () => ({ status: true, data: { buildings: [{ id: 'building-a', name: '图书馆A' }] } }),
    ...overrides.api,
  };
  const schedule = {
    getSchedules: async () => ({ status: true, data: [] }),
    createSchedule: async () => ({ status: true }),
    deleteSchedule: async () => ({ status: true }),
    toggleSchedule: async () => ({ status: true }),
    executeSchedules: async () => ({ status: true }),
    ...overrides.schedule,
  };
  const ocr = {
    autoLoginWithCaptcha: async (getCaptcha, login) => {
      const captcha = await getCaptcha();
      const result = await login(captcha.captchaId, 'abcd');
      return { success: true, result };
    }, ...overrides.ocr,
  };
  const native = {
    StyleSheet: { create: value => value },
    Platform: { OS: 'android' },
    Alert: { alert: (...args) => alerts.push(args) },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  for (const component of ['View', 'Text', 'TextInput', 'TouchableOpacity', 'Image', 'ActivityIndicator', 'KeyboardAvoidingView', 'ScrollView', 'RefreshControl']) native[component] = component;
  native.Modal = ({ visible, children, ...props }) => visible ? React.createElement('Modal', props, children) : null;
  native.FlatList = props => React.createElement('FlatList', props,
    props.ListHeaderComponent,
    props.data?.length ? props.data.map((item, index) => React.createElement(React.Fragment, { key: props.keyExtractor?.(item, index) ?? index }, props.renderItem({ item, index }))) : props.ListEmptyComponent,
    props.ListFooterComponent);
  const modules = new Map([
    [path.join(project, 'src/api/client.js'), api],
    [path.join(project, 'src/api/scheduleApi.js'), schedule],
    [path.join(project, 'src/utils/storage.js'), storage],
    [path.join(project, 'src/utils/ocr.js'), ocr],
  ]);
  function load(relative) {
    const file = path.resolve(project, relative);
    if (modules.has(file)) return modules.get(file);
    const entry = { exports: {} };
    modules.set(file, entry.exports);
    const code = babel.transformSync(fs.readFileSync(file, 'utf8'), { filename: file, babelrc: false, configFile: false, plugins: [jsx, commonjs] }).code;
    const context = {
      module: entry, exports: entry.exports,
      require: spec => {
        if (spec === 'react') return React;
        if (spec === 'react-native') return native;
        if (spec === '@react-navigation/native') return { useFocusEffect: callback => React.useEffect(callback, [callback]), useIsFocused: () => true };
        if (spec === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
        if (!spec.startsWith('.')) throw new Error(`Unexpected UI dependency: ${spec}`);
        return load(path.relative(project, path.resolve(path.dirname(file), `${spec}.js`)));
      },
      console, Date, Promise, setTimeout, clearTimeout,
      fetch: () => { throw new Error('Actual network calls are forbidden in UI tests'); },
    };
    vm.runInNewContext(code, context, { filename: file });
    return entry.exports;
  }
  let tree;
  async function mount(screen, props = {}) {
    const Component = load(`src/screens/${screen}.js`).default;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Component, { navigation, ...props }), { createNodeMock: () => ({ focus() {} }) }); });
    return tree;
  }
  async function act(action) { return renderer.act(async () => { await action?.(); }); }
  async function unmount() { if (tree) await act(() => tree.unmount()); }
  return { core, storage, api, schedule, ocr, navigation, alerts, resets, navigations, load, mount, act, unmount, get root() { return tree.root; } };
}
function text(node) { return typeof node === 'string' || typeof node === 'number' ? String(node) : node.children.map(text).join(''); }
function button(root, label) {
  const matches = root.findAllByType('TouchableOpacity').filter(node => text(node).includes(label));
  if (!matches.length) throw new Error(`Button not found: ${label}`);
  return matches[0];
}
function input(root, label) { return root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label || node.props.placeholder === label); }
module.exports = { uiHarness, deferred, text, button, input };
