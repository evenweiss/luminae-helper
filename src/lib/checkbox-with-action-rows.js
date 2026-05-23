/**
 * 带「功能行」的多选 Checkbox：与 @inquirer/checkbox 行为一致，
 * 但列表末尾的 `__back__` / `__exit__` 为功能项——仅支持方向键聚焦 + 回车触发，
 * 不参与空格勾选；普通选项仍用空格多选、回车提交。
 *
 * 用于避免 stock Checkbox 把返回/退出做成 disabled（回车报错）或可勾选（与产品预期不符），
 * 同时避免自管 stdin raw 与 @inquirer 竞态。
 */
import { cursorHide } from "@inquirer/ansi";
import {
  Separator,
  ValidationError,
  createPrompt,
  isDownKey,
  isEnterKey,
  isNumberKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  useMemo,
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";
import { styleText } from "node:util";

/** 与 ui.js 中 parseCheckboxResult 约定的导航返回值 */
export const NAV_BACK = "__back__";
export const NAV_EXIT = "__exit__";

const checkboxTheme = {
  icon: {
    checked: styleText("green", figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
    disabledChecked: styleText("green", figures.circleDouble),
    disabledUnchecked: "-",
  },
  style: {
    disabled: (text) => styleText("dim", text),
    renderSelectedChoices: (selectedChoices) => selectedChoices.map((choice) => choice.short).join(", "),
    description: (text) => styleText("cyan", text),
    keysHelpTip: (keys) =>
      keys.map(([key, action]) => `${styleText("bold", key)} ${styleText("dim", action)}`).join(styleText("dim", " • ")),
  },
  i18n: {
    disabledError: "This option is disabled and cannot be toggled.",
    /** 焦点在功能行时用户按了空格：提示改用回车 */
    actionRowUseEnter: "此项为功能操作，请按回车确认",
  },
  keybindings: [],
};

/**
 * @param {unknown} item
 * @returns {boolean}
 */
function isActionRow(item) {
  if (Separator.isSeparator(item) || item == null || typeof item !== "object") return false;
  const v = /** @type {{ value?: unknown }} */ (item).value;
  return v === NAV_BACK || v === NAV_EXIT;
}

function isSelectable(item) {
  return !Separator.isSeparator(item) && !item.disabled && !isActionRow(item);
}

function isNavigable(item) {
  return !Separator.isSeparator(item);
}

function isChecked(item) {
  return !Separator.isSeparator(item) && item.checked;
}

function toggle(item) {
  return isSelectable(item) ? { ...item, checked: !item.checked } : item;
}

function check(checked) {
  return function (item) {
    return isSelectable(item) ? { ...item, checked } : item;
  };
}

function normalizeChoices(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      const name = String(choice);
      return {
        value: choice,
        name,
        short: name,
        checkedName: name,
        disabled: false,
        checked: false,
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      checkedName: choice.checkedName ?? name,
      disabled: choice.disabled ?? false,
      checked: choice.checked ?? false,
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}

export default createPrompt((config, done) => {
  const { pageSize = 7, loop = true, required, validate = () => true } = config;
  const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
  const theme = makeTheme(checkboxTheme, config.theme);
  const { keybindings } = theme;
  const [status, setStatus] = useState("idle");
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState(normalizeChoices(config.choices));
  const bounds = useMemo(() => {
    const first = items.findIndex(isNavigable);
    const last = items.findLastIndex(isNavigable);
    if (first === -1) {
      throw new ValidationError("[checkbox-with-action-rows] No navigable choices.");
    }
    return { first, last };
  }, [items]);
  const [active, setActive] = useState(bounds.first);
  const [errorMsg, setError] = useState();
  /** 若为 `__back__` / `__exit__`，表示用户在高亮功能行上按回车结束，用于 done 态展示文案 */
  const [navSubmitValue, setNavSubmitValue] = useState(/** @type {string | null} */ (null));

  useKeypress(async (key) => {
    if (isEnterKey(key)) {
      const activeItem = items[active];
      // 功能行：回车立即结束 prompt，返回单元素数组供 parseCheckboxResult 识别
      if (activeItem && !Separator.isSeparator(activeItem) && isActionRow(activeItem)) {
        setError(undefined);
        setNavSubmitValue(activeItem.value);
        setStatus("done");
        done([activeItem.value]);
        return;
      }

      const selection = items.filter(isChecked);
      const isValid = await validate([...selection]);
      if (required && !selection.length) {
        setError("At least one choice must be selected");
      } else if (isValid === true) {
        setNavSubmitValue(null);
        setStatus("done");
        done(selection.map((choice) => choice.value));
      } else {
        setError(isValid || "You must select a valid value");
      }
    } else if (isUpKey(key, keybindings) || isDownKey(key, keybindings)) {
      if (errorMsg) {
        setError(undefined);
      }
      if (
        loop ||
        (isUpKey(key, keybindings) && active !== bounds.first) ||
        (isDownKey(key, keybindings) && active !== bounds.last)
      ) {
        const offset = isUpKey(key, keybindings) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + items.length) % items.length;
        } while (!isNavigable(items[next]));
        setActive(next);
      }
    } else if (isSpaceKey(key)) {
      const activeItem = items[active];
      if (activeItem && !Separator.isSeparator(activeItem)) {
        if (isActionRow(activeItem)) {
          setError(theme.i18n.actionRowUseEnter ?? "此项为功能操作，请按回车确认");
        } else if (activeItem.disabled) {
          setError(theme.i18n.disabledError);
        } else {
          setError(undefined);
          setItems(items.map((choice, i) => (i === active ? toggle(choice) : choice)));
        }
      }
    } else if (key.name === shortcuts.all) {
      const selectAll = items.some((choice) => isSelectable(choice) && !choice.checked);
      setItems(items.map(check(selectAll)));
    } else if (key.name === shortcuts.invert) {
      setItems(items.map(toggle));
    } else if (isNumberKey(key)) {
      const selectedIndex = Number(key.name) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item) => {
        if (Separator.isSeparator(item)) return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      const selectedItem = items[position];
      if (selectedItem && isSelectable(selectedItem)) {
        setActive(position);
        setItems(items.map((choice, i) => (i === position ? toggle(choice) : choice)));
      } else if (selectedItem && isActionRow(selectedItem)) {
        setActive(position);
      }
    }
  });

  const message = theme.style.message(config.message, status);
  let description;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }) {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }
      const cursor = isActive ? theme.icon.cursor : " ";
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        const checkbox = item.checked ? theme.icon.disabledChecked : theme.icon.disabledUnchecked;
        return theme.style.disabled(`${cursor}${checkbox} ${item.name} ${disabledLabel}`);
      }
      // 功能行：不占「○ + 空格」列——文案紧跟指针，与勾选行里圆圈所在列对齐（视觉上更靠左）
      if (isActionRow(item)) {
        if (isActive) {
          description = item.description;
        }
        const color = isActive ? theme.style.highlight : (x) => x;
        return color(`${cursor}${item.name}`);
      }
      if (isActive) {
        description = item.description;
      }
      const checkbox = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const name = item.checked ? item.checkedName : item.name;
      const color = isActive ? theme.style.highlight : (x) => x;
      return color(`${cursor}${checkbox} ${name}`);
    },
    pageSize,
    loop,
  });

  if (status === "done") {
    if (navSubmitValue === NAV_BACK) {
      return [prefix, message, theme.style.answer("↩ 返回")].filter(Boolean).join(" ");
    }
    if (navSubmitValue === NAV_EXIT) {
      return [prefix, message, theme.style.answer("✕ 退出")].filter(Boolean).join(" ");
    }
    const selection = items.filter(isChecked);
    const answer = theme.style.answer(theme.style.renderSelectedChoices(selection, items));
    return [prefix, message, answer].filter(Boolean).join(" ");
  }

  const keys = [
    ["↑↓", "移动"],
    ["space", "多选"],
  ];
  if (shortcuts.all) keys.push([shortcuts.all, "all"]);
  if (shortcuts.invert) keys.push([shortcuts.invert, "invert"]);
  keys.push(["⏎", "提交 / 执行"]);
  const helpLine = theme.style.keysHelpTip(keys);
  const lines = [
    [prefix, message].filter(Boolean).join(" "),
    page,
    " ",
    description ? theme.style.description(description) : "",
    errorMsg ? theme.style.error(errorMsg) : "",
    helpLine,
  ]
    .filter(Boolean)
    .join("\n")
    .trimEnd();
  return `${lines}${cursorHide}`;
});
