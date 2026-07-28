from dataclasses import dataclass, field

from .models import QueryKey


@dataclass
class QueryHistory:
    current: QueryKey | None = None
    _back_stack: list[QueryKey] = field(default_factory=list)

    @property
    def can_go_back(self) -> bool:
        return bool(self._back_stack)

    def visit(self, key: QueryKey) -> None:
        if key == self.current:
            return
        if self.current is not None:
            self._back_stack.append(self.current)
        self.current = key

    def back(self) -> QueryKey | None:
        if not self._back_stack:
            return None
        self.current = self._back_stack.pop()
        return self.current

    def clear(self) -> None:
        self.current = None
        self._back_stack.clear()


class ResultPager:
    def __init__(self, total: int, page_size: int = 200) -> None:
        if total < 0:
            raise ValueError("total cannot be negative")
        if page_size <= 0:
            raise ValueError("page_size must be positive")
        self.total = total
        self.page_size = page_size
        self.visible_count = min(total, page_size)

    @property
    def has_more(self) -> bool:
        return self.visible_count < self.total

    def load_more(self) -> int:
        self.visible_count = min(self.total, self.visible_count + self.page_size)
        return self.visible_count
