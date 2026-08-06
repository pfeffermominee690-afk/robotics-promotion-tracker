(function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const REQUIRED_FIELDS = [
    "id",
    "university",
    "college",
    "category",
    "admissionYear",
    "title",
    "directions",
    "roboticsEligibility",
    "matchLevel",
    "publishDate",
    "deadline",
    "status",
    "officialUrl",
    "lastVerified",
    "notes",
  ];

  const MATCH_RANK = {
    高: 3,
    高度匹配: 3,
    中: 2,
    中度匹配: 2,
    低: 1,
    一般匹配: 1,
  };

  // 允许 Node.js 在不创建浏览器页面的情况下复用纯数据逻辑做自动化验收。
  if (typeof document === "undefined") {
    module.exports = {
      normalizeNotice,
      parseDateOnly,
      daysFromToday,
      getEffectiveStatus,
      filterAndSort,
    };
    return;
  }

  const state = {
    notices: [],
    schoolQuery: "",
    collegeQuery: "",
    category: "全部",
    status: "全部",
    sort: "deadline-asc",
    loaded: false,
  };

  const elements = {
    schoolSearch: document.querySelector("#school-search"),
    collegeSearch: document.querySelector("#college-search"),
    sortSelect: document.querySelector("#sort-select"),
    categoryFilters: document.querySelector("#category-filters"),
    statusFilters: document.querySelector("#status-filters"),
    resetFilters: document.querySelector("#reset-filters"),
    lastVerified: document.querySelector("#last-verified"),
    verifiedCount: document.querySelector("#verified-count"),
    statTotal: document.querySelector("#stat-total"),
    statCamp: document.querySelector("#stat-camp"),
    statPre: document.querySelector("#stat-pre"),
    statOpen: document.querySelector("#stat-open"),
    resultsSummary: document.querySelector("#results-summary"),
    loadingState: document.querySelector("#loading-state"),
    errorState: document.querySelector("#error-state"),
    emptyState: document.querySelector("#empty-state"),
    emptyTitle: document.querySelector("#empty-title"),
    emptyMessage: document.querySelector("#empty-message"),
    noticeList: document.querySelector("#notice-list"),
  };

  function hasRequiredFields(record) {
    return (
      record &&
      typeof record === "object" &&
      REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(record, field))
    );
  }

  function normalizeNotice(record) {
    return {
      ...record,
      id: String(record.id),
      university: String(record.university || "").trim(),
      college: String(record.college || "").trim(),
      category: String(record.category || "").trim(),
      title: String(record.title || "").trim(),
      directions: Array.isArray(record.directions)
        ? record.directions.map(String).map((item) => item.trim()).filter(Boolean)
        : String(record.directions || "")
            .split(/[、,，]/)
            .map((item) => item.trim())
            .filter(Boolean),
      roboticsEligibility: String(record.roboticsEligibility || "").trim(),
      matchLevel: String(record.matchLevel || "").trim(),
      publishDate: String(record.publishDate || "").trim(),
      deadline: String(record.deadline || "").trim(),
      status: String(record.status || "").trim(),
      officialUrl: String(record.officialUrl || "").trim(),
      lastVerified: String(record.lastVerified || "").trim(),
      notes: String(record.notes || "").trim(),
    };
  }

  function parseDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function todayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function daysFromToday(dateValue) {
    const date = parseDateOnly(dateValue);
    if (!date) return null;
    return Math.round((date.getTime() - todayUtc().getTime()) / DAY_MS);
  }

  function getEffectiveStatus(notice) {
    if (notice.status === "链接待核验") return "链接待核验";
    if (notice.status === "待发布" || !parseDateOnly(notice.deadline)) return "待发布";

    const remaining = daysFromToday(notice.deadline);
    if (remaining < 0) return "已截止";
    if (remaining <= 7) return "即将截止";
    return "报名中";
  }

  function getMatchRank(matchLevel) {
    return MATCH_RANK[matchLevel] || 0;
  }

  function getDateRank(value, fallback) {
    const date = parseDateOnly(value);
    return date ? date.getTime() : fallback;
  }

  function compareDeadlinePriority(left, right) {
    const buckets = {
      即将截止: 0,
      报名中: 0,
      待发布: 1,
      链接待核验: 2,
      已截止: 3,
    };
    const leftStatus = getEffectiveStatus(left);
    const rightStatus = getEffectiveStatus(right);
    const bucketDifference = (buckets[leftStatus] ?? 2) - (buckets[rightStatus] ?? 2);
    if (bucketDifference) return bucketDifference;

    if (leftStatus === "已截止" && rightStatus === "已截止") {
      return getDateRank(right.deadline, 0) - getDateRank(left.deadline, 0);
    }
    return (
      getDateRank(left.deadline, Number.POSITIVE_INFINITY) -
      getDateRank(right.deadline, Number.POSITIVE_INFINITY)
    );
  }

  function filterAndSort(notices, filters) {
    const schoolQuery = filters.schoolQuery.trim().toLocaleLowerCase("zh-CN");
    const collegeQuery = filters.collegeQuery.trim().toLocaleLowerCase("zh-CN");

    const filtered = notices.filter((notice) => {
      const schoolMatches = notice.university.toLocaleLowerCase("zh-CN").includes(schoolQuery);
      const collegeMatches = notice.college.toLocaleLowerCase("zh-CN").includes(collegeQuery);
      const categoryMatches = filters.category === "全部" || notice.category === filters.category;
      const statusMatches = filters.status === "全部" || getEffectiveStatus(notice) === filters.status;
      return schoolMatches && collegeMatches && categoryMatches && statusMatches;
    });

    return filtered.sort((left, right) => {
      if (filters.sort === "match-desc") {
        return (
          getMatchRank(right.matchLevel) - getMatchRank(left.matchLevel) ||
          compareDeadlinePriority(left, right) ||
          left.university.localeCompare(right.university, "zh-CN")
        );
      }

      if (filters.sort === "publish-desc") {
        return (
          getDateRank(right.publishDate, 0) - getDateRank(left.publishDate, 0) ||
          getMatchRank(right.matchLevel) - getMatchRank(left.matchLevel)
        );
      }

      return (
        compareDeadlinePriority(left, right) ||
        getMatchRank(right.matchLevel) - getMatchRank(left.matchLevel) ||
        left.university.localeCompare(right.university, "zh-CN")
      );
    });
  }

  function formatDate(value) {
    if (!parseDateOnly(value)) return "待公布";
    return value.replace(/-/g, ".");
  }

  function deadlineText(notice) {
    const status = getEffectiveStatus(notice);
    if (status === "待发布") return "截止时间待公布";
    if (status === "链接待核验") return "请重新核验官方链接";

    const remaining = daysFromToday(notice.deadline);
    if (remaining === 0) return "今天截止";
    if (remaining > 0) return `剩余 ${remaining} 天`;
    return `已截止 ${Math.abs(remaining)} 天`;
  }

  function statusClass(status) {
    return (
      {
        报名中: "status-open",
        即将截止: "status-soon",
        已截止: "status-closed",
        待发布: "status-pending",
        链接待核验: "status-verify",
      }[status] || "status-pending"
    );
  }

  function matchClass(matchLevel) {
    const rank = getMatchRank(matchLevel);
    if (rank >= 3) return "match-high";
    if (rank === 2) return "match-medium";
    return "match-low";
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createNoticeCard(notice) {
    const card = createElement("article", "notice-card");
    card.dataset.noticeId = notice.id;

    const main = createElement("div", "notice-main");
    const tags = createElement("div", "notice-tags");
    const categoryTag = createElement("span", "category-tag", notice.category);
    const effectiveStatus = getEffectiveStatus(notice);
    const statusTag = createElement(
      "span",
      `status-tag ${statusClass(effectiveStatus)}`,
      effectiveStatus,
    );
    const matchTag = createElement(
      "span",
      `match-tag ${matchClass(notice.matchLevel)}`,
      `匹配度：${notice.matchLevel}`,
    );
    tags.append(categoryTag, statusTag, matchTag);

    const schoolLine = createElement("div", "school-line");
    schoolLine.append(
      createElement("strong", "", notice.university),
      createElement("span", "school-separator", "/"),
      createElement("span", "college-name", notice.college),
    );

    const title = createElement("h3", "notice-title");
    const titleLink = createElement("a", "", notice.title);
    titleLink.href = notice.officialUrl;
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    title.append(titleLink);

    const directionList = createElement("div", "direction-list");
    notice.directions.forEach((direction) => {
      directionList.append(createElement("span", "direction-tag", direction));
    });

    const eligibility = createElement("p", "eligibility");
    eligibility.append(createElement("strong", "", "机器人工程适配："));
    eligibility.append(document.createTextNode(notice.roboticsEligibility || "通知正文未单独说明"));

    main.append(tags, schoolLine, title);
    if (notice.directions.length) main.append(directionList);
    main.append(eligibility);

    if (notice.notes) {
      const notes = createElement("p", "notice-notes");
      notes.append(createElement("strong", "", "备注："));
      notes.append(document.createTextNode(notice.notes));
      main.append(notes);
    }

    const side = createElement("div", "notice-side");
    const deadlineBlock = createElement("div", "deadline-block");
    deadlineBlock.append(
      createElement("span", "deadline-label", "报名截止"),
      createElement("strong", "deadline-date", formatDate(notice.deadline)),
      createElement("span", "deadline-relative", deadlineText(notice)),
    );

    const linkBlock = createElement("div", "link-block");
    const officialLink = createElement("a", "official-link");
    officialLink.href = notice.officialUrl;
    officialLink.target = "_blank";
    officialLink.rel = "noopener noreferrer";
    officialLink.append(
      document.createTextNode("查看官方通知"),
      createElement("span", "", "↗"),
    );
    officialLink.setAttribute("aria-label", `在新标签页打开：${notice.title}`);

    const verification = createElement("div", "verification-line");
    verification.append(
      createElement("span", "", `发布 ${formatDate(notice.publishDate)}`),
      createElement("span", "", "·"),
      createElement("span", "", `核验 ${formatDate(notice.lastVerified)}`),
    );
    linkBlock.append(officialLink, verification);
    side.append(deadlineBlock, linkBlock);
    card.append(main, side);
    return card;
  }

  function updateStats() {
    const notices = state.notices;
    const openStatuses = new Set(["报名中", "即将截止"]);
    elements.statTotal.textContent = notices.length;
    elements.statCamp.textContent = notices.filter((notice) => notice.category === "夏令营").length;
    elements.statPre.textContent = notices.filter((notice) => notice.category === "预推免").length;
    elements.statOpen.textContent = notices.filter((notice) =>
      openStatuses.has(getEffectiveStatus(notice)),
    ).length;

    const verifiedDates = notices
      .map((notice) => notice.lastVerified)
      .filter((value) => parseDateOnly(value))
      .sort()
      .reverse();

    elements.lastVerified.textContent = verifiedDates.length
      ? formatDate(verifiedDates[0])
      : "暂无已核验通知";
    elements.verifiedCount.textContent = notices.length
      ? `${notices.length} 条记录已保留官方原始链接`
      : "等待录入首批官方通知";
  }

  function render() {
    if (!state.loaded) return;
    const visible = filterAndSort(state.notices, state);
    elements.noticeList.replaceChildren(...visible.map(createNoticeCard));
    elements.resultsSummary.textContent = `共 ${visible.length} 条`;

    const isEmpty = visible.length === 0;
    elements.emptyState.hidden = !isEmpty;
    if (isEmpty && state.notices.length === 0) {
      elements.emptyTitle.textContent = "暂未收录通知";
      elements.emptyMessage.textContent = "等待录入首批经过官方正文核验的通知。";
    } else if (isEmpty) {
      elements.emptyTitle.textContent = "没有符合条件的通知";
      elements.emptyMessage.textContent = "请调整学校、学院或状态筛选条件后重试。";
    }
  }

  function syncFilterButtons(container, selectedValue) {
    container.querySelectorAll("[data-value]").forEach((button) => {
      const isActive = button.dataset.value === selectedValue;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function resetFilters() {
    state.schoolQuery = "";
    state.collegeQuery = "";
    state.category = "全部";
    state.status = "全部";
    state.sort = "deadline-asc";
    elements.schoolSearch.value = "";
    elements.collegeSearch.value = "";
    elements.sortSelect.value = state.sort;
    syncFilterButtons(elements.categoryFilters, state.category);
    syncFilterButtons(elements.statusFilters, state.status);
    render();
  }

  function bindFilterGroup(container, stateKey) {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-value]");
      if (!button || !container.contains(button)) return;
      state[stateKey] = button.dataset.value;
      syncFilterButtons(container, state[stateKey]);
      render();
    });
  }

  function bindEvents() {
    elements.schoolSearch.addEventListener("input", (event) => {
      state.schoolQuery = event.target.value;
      render();
    });
    elements.collegeSearch.addEventListener("input", (event) => {
      state.collegeQuery = event.target.value;
      render();
    });
    elements.sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    elements.resetFilters.addEventListener("click", resetFilters);
    bindFilterGroup(elements.categoryFilters, "category");
    bindFilterGroup(elements.statusFilters, "status");
  }

  async function loadNotices() {
    try {
      const response = await fetch("data/notices.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("notices.json 顶层必须是数组");

      const invalidRecords = payload.filter((record) => !hasRequiredFields(record));
      if (invalidRecords.length) {
        console.warn(`已忽略 ${invalidRecords.length} 条字段不完整的通知记录。`);
      }
      state.notices = payload.filter(hasRequiredFields).map(normalizeNotice);
      state.loaded = true;
      elements.loadingState.hidden = true;
      updateStats();
      render();
    } catch (error) {
      console.error("通知数据加载失败：", error);
      state.loaded = true;
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.resultsSummary.textContent = "加载失败";
      elements.lastVerified.textContent = "数据加载失败";
      elements.verifiedCount.textContent = "请检查数据文件";
      [elements.statTotal, elements.statCamp, elements.statPre, elements.statOpen].forEach((element) => {
        element.textContent = "—";
      });
    }
  }

  bindEvents();
  loadNotices();

  // 只用于本地自动化验收；不会写入 notices.json，也不会持久化测试数据。
  window.__NOTICE_BOARD_TEST__ = Object.freeze({
    getEffectiveStatus,
    filterAndSort,
    setNotices(records) {
      state.notices = records.filter(hasRequiredFields).map(normalizeNotice);
      state.loaded = true;
      elements.loadingState.hidden = true;
      elements.errorState.hidden = true;
      resetFilters();
      updateStats();
      render();
    },
    getVisibleIds() {
      return filterAndSort(state.notices, state).map((notice) => notice.id);
    },
  });
})();
