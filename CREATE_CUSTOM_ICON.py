"""
CREATE_CUSTOM_ICON.py
====================
Generates a custom trading agent icon (PNG/ICO format) for the desktop shortcut.
Requirements: pip install pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_trading_agent_icon(output_path="icon.ico", size=256):
    """
    Create a custom trading agent icon with robot + chart theme.
    
    Args:
        output_path: Output file path (icon.ico)
        size: Icon size in pixels (default 256x256)
    """
    # Create new image with gradient background
    img = Image.new('RGB', (size, size), color=(20, 30, 60))  # Dark blue
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Draw gradient background (dark blue to purple)
    for y in range(size):
        ratio = y / size
        r = int(20 + (100 - 20) * ratio)
        g = int(30 + (50 - 30) * ratio)
        b = int(60 + (120 - 60) * ratio)
        draw.rectangle([(0, y), (size, y+1)], fill=(r, g, b))
    
    # Draw trading chart (uptrend)
    chart_color = (0, 200, 100)  # Green
    chart_y_base = int(size * 0.7)
    chart_x_start = int(size * 0.2)
    chart_x_end = int(size * 0.8)
    chart_height = int(size * 0.4)
    
    points = []
    steps = 5
    for i in range(steps + 1):
        x = chart_x_start + (chart_x_end - chart_x_start) * (i / steps)
        # Uptrend with some volatility
        y = chart_y_base - (chart_height * (i / steps) * 0.8) - (chart_height * 0.1 * (i % 2))
        points.append((x, y))
    
    # Draw chart line
    for i in range(len(points) - 1):
        draw.line([points[i], points[i+1]], fill=chart_color, width=4)
    
    # Draw chart points
    for point in points:
        draw.ellipse(
            [(point[0]-4, point[1]-4), (point[0]+4, point[1]+4)],
            fill=chart_color,
            outline=(255, 255, 255)
        )
    
    # Draw robot head (simple)
    robot_x = int(size * 0.5)
    robot_y = int(size * 0.25)
    robot_size = int(size * 0.15)
    
    # Head
    draw.rectangle(
        [(robot_x - robot_size, robot_y - robot_size),
         (robot_x + robot_size, robot_y + robot_size)],
        outline=(0, 200, 255),
        width=3
    )
    
    # Eyes
    eye_offset = int(robot_size * 0.4)
    for eye_x in [robot_x - eye_offset, robot_x + eye_offset]:
        draw.ellipse(
            [(eye_x - 3, robot_y - 5), (eye_x + 3, robot_y + 5)],
            fill=(0, 255, 100)
        )
    
    # Draw bullish indicator (arrow up)
    arrow_x = int(size * 0.15)
    arrow_y = int(size * 0.5)
    arrow_size = int(size * 0.08)
    
    # Arrow pointing up
    draw.polygon(
        [
            (arrow_x, arrow_y + arrow_size),
            (arrow_x - arrow_size//2, arrow_y),
            (arrow_x + arrow_size//2, arrow_y)
        ],
        fill=(0, 255, 100),
        outline=(255, 255, 0)
    )
    
    # Draw bearish indicator (arrow down)
    arrow_x_2 = int(size * 0.85)
    draw.polygon(
        [
            (arrow_x_2, arrow_y - arrow_size),
            (arrow_x_2 - arrow_size//2, arrow_y),
            (arrow_x_2 + arrow_size//2, arrow_y)
        ],
        fill=(255, 100, 100),
        outline=(255, 255, 0)
    )
    
    # Add text label
    try:
        # Try to use a built-in font
        font_size = int(size * 0.08)
        font = ImageFont.load_default()
    except:
        font = None
    
    # Draw title
    text = "AI TRADER"
    text_bbox = draw.textbbox((0, 0), text, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_x = (size - text_width) // 2
    text_y = int(size * 0.92)
    
    draw.text((text_x, text_y), text, fill=(0, 200, 255), font=font)
    
    # Save as PNG
    png_path = output_path.replace('.ico', '.png')
    img.save(png_path, 'PNG')
    print(f"✓ Icon PNG created: {png_path}")
    
    # Convert to ICO
    try:
        img_resized = img.copy()
        img_resized.thumbnail((256, 256), Image.Resampling.LANCZOS)
        img_resized.save(output_path, 'ICO')
        print(f"✓ Icon ICO created: {output_path}")
        return True
    except Exception as e:
        print(f"⚠ Could not save as ICO: {e}")
        print(f"  You can convert {png_path} to ICO online:")
        print(f"  https://convertio.co/png-ico/")
        return False


if __name__ == "__main__":
    import sys
    
    output_file = sys.argv[1] if len(sys.argv) > 1 else "icon.ico"
    
    print("=" * 60)
    print("Creating Custom Trading Agent Icon")
    print("=" * 60)
    print()
    
    try:
        success = create_trading_agent_icon(output_file)
        print()
        if success:
            print("✓ Icon ready! Update your shortcut:")
            print(f"  Right-click shortcut → Properties → Change Icon")
            print(f"  Select: {output_file}")
        else:
            print("⚠ PNG created but ICO conversion failed")
            print("  Convert the PNG to ICO manually at:")
            print("  https://convertio.co/png-ico/")
    except ImportError:
        print("ERROR: Pillow not installed")
        print("Install with: pip install pillow")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
