import os

def get_deployment_url() -> str:
    """
    Get the deployment URL from environment variables and convert it to the HTTP endpoint format.
    
    Returns:
        str: Deployment URL with .site suffix for HTTP routes
        
    Raises:
        ValueError: If CONVEX_URL is not set or invalid
    """
    convex_url = os.getenv("CONVEX_URL", "").strip()
    if convex_url == "":
        raise ValueError("CONVEX_URL environment variable is not set")
    
    # Remove trailing slash if present
    if convex_url.endswith("/"):
        convex_url = convex_url[:-1]
    
    # Ensure URL contains .cloud
    if not convex_url.endswith(".cloud"):
        raise ValueError("CONVEX_URL must be a valid Convex deployment URL (ending with .cloud)")
    
    # Convert from .cloud to .site for HTTP routes
    return convex_url.replace(".cloud", ".site")
