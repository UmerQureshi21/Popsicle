import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoadMore from "./LoadMore";

/** A stand-in IntersectionObserver whose `show()` says the element scrolled into view. */
class FakeObserver {
  static last: FakeObserver | null = null;
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  show(visible = true) {
    this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeObserver.last = null;
});

describe("LoadMore", () => {
  it("says how many are showing and loads more on click", async () => {
    const onMore = vi.fn();
    render(<LoadMore shown={30} total={45} hasMore loading={false} onMore={onMore} />);
    expect(screen.getByText("Showing 30 of 45")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("shows Loading… while a page is on its way", () => {
    render(<LoadMore shown={30} total={45} hasMore loading onMore={() => {}} />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("is gone when everything is showing", () => {
    const { container } = render(<LoadMore shown={45} total={45} hasMore={false} loading={false} onMore={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("loads the next page by itself when scrolled into view", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const first = vi.fn();
    const { rerender, unmount } = render(<LoadMore shown={30} total={90} hasMore loading={false} onMore={first} />);
    act(() => FakeObserver.last!.show(false));
    expect(first).not.toHaveBeenCalled();
    act(() => FakeObserver.last!.show());
    expect(first).toHaveBeenCalledOnce();

    // Always calls the latest onMore (it changes as pages load).
    const second = vi.fn();
    rerender(<LoadMore shown={60} total={90} hasMore loading={false} onMore={second} />);
    act(() => FakeObserver.last!.show());
    expect(second).toHaveBeenCalledOnce();
    const observer = FakeObserver.last!;
    unmount();
    expect(observer.disconnected).toBe(true);
  });
});
