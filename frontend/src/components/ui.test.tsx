import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Avatar, Button, EmptyState, Modal, Popover, StatusBadge, Tooltip } from "./ui";

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hi">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes with Escape, the close button or a click outside, but not a click inside", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Review" footer={<span>footer</span>} wide>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Review");
    expect(screen.getByText("footer")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.mouseDown(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("restores page scrolling when closed", () => {
    document.body.style.overflow = "auto";
    const { rerender } = render(
      <Modal open compact onClose={() => {}} title="x">
        y
      </Modal>,
    );
    rerender(
      <Modal open={false} compact onClose={() => {}} title="x">
        y
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("Popover", () => {
  it("closes on a click outside or Escape, not on a click inside", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <div>
        <span>outside</span>
        <Popover open onClose={onClose}>
          <span>inside</span>
        </Popover>
      </div>,
    );
    vi.runAllTimers(); // the outside-click listener is added on the next tick
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText("outside"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("renders nothing while closed", () => {
    render(
      <Popover open={false} onClose={() => {}}>
        inside
      </Popover>,
    );
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
  });
});

it("Tooltip shows its label next to the content", () => {
  render(
    <Tooltip label="Attach files">
      <button>clip</button>
    </Tooltip>,
  );
  expect(screen.getByText("Attach files")).toBeInTheDocument();
});

it("Avatar shows initials with a colour picked from the name", () => {
  const { container } = render(
    <>
      <Avatar name="Jane Doe" />
      <Avatar name="Sam Lee" size={40} />
    </>,
  );
  const [a, b] = container.querySelectorAll("span");
  expect(a).toHaveTextContent("JD");
  expect(b).toHaveTextContent("SL");
  expect(b.style.width).toBe("40px");
});

it("StatusBadge labels statuses", () => {
  render(
    <>
      <StatusBadge status="already_sent" />
      <StatusBadge status="sending" />
      <StatusBadge status={"mystery" as "sent"} />
    </>,
  );
  expect(screen.getByText("already emailed")).toBeInTheDocument();
  expect(screen.getByText("sending").querySelector(".animate-pulse")).toBeInTheDocument();
  expect(screen.getByText("mystery").className).toContain("bg-cloud");
});

it("Button passes props through", async () => {
  const onClick = vi.fn();
  render(
    <>
      <Button onClick={onClick}>Secondary</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger" disabled>
        Danger
      </Button>
    </>,
  );
  await userEvent.setup().click(screen.getByText("Secondary"));
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByText("Primary").className).toContain("bg-crimson");
  expect(screen.getByText("Danger")).toBeDisabled();
});

it("EmptyState", () => {
  render(
    <>
      <EmptyState icon={<i />} title="Nothing yet">
        Add some
      </EmptyState>
      <EmptyState icon={<i />} title="Bare" />
    </>,
  );
  expect(screen.getByText("Nothing yet")).toBeInTheDocument();
  expect(screen.getByText("Add some")).toBeInTheDocument();
});
